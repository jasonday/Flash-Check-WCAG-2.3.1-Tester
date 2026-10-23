# Flash Check: WCAG 2.3.1 Tester

Flash Check is a Chrome extension that records a web page and reports whether it fails WCAG 2.2 Success Criterion 2.3.1, Three Flashes or Below Threshold. It checks both general flashes and red flashes, shows where on the page the failure happened, and names the likely source elements.

It is meant to replace PEAT for web content. PEAT follows the WCAG 2.0 math, needs a video file, and is no longer updated.

## Install

1. Open `chrome://extensions` in Chrome 116 or later.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this folder (the one with `manifest.json`).
4. Pin **Flash Check: WCAG 2.3.1 Tester** to the toolbar.

## Run a test

1. Open the page you want to test. Set the browser window to the largest size and zoom a user is likely to use.
2. Select the extension button, choose a recording length, and select **Start test**.
3. Play every video, carousel, and animation on the page during the recording. You can close the popup; recording continues and the toolbar badge counts down.
4. Do not scroll during the recording. Scrolling moves content and can look like flashing. If it happens, the report flags those results for review.
5. When the recording ends, the badge shows **FAIL**, **PASS**, or **?** (needs review), the report opens in a new tab, and failing areas are outlined on the page.

The tool never replays the recording, so testing a page does not expose you to more flashing than the page itself does. The report shows one still frame per failure.

### Reading the report

- **Verdict**: Fail, Pass, or Needs review. "Needs review" means the recording could not support a result, for example nothing on the page changed, the frame rate was too low, or failures only happened while scrolling.
- **Failures**: each period when flashing broke both limits at once, with time range, peak area, fastest flash rate, location in CSS pixels, a still frame with the area outlined, and likely source elements (CSS selectors).
- **Fast flashing below the area limit**: areas that flashed too fast but were small enough to pass. Worth a look, since users closer to the screen see them larger.
- **Chart**: flashing area over time against the 25% limit, with a table view.
- **Possible flash sources**: videos, canvases, animated images, frames, and fast CSS animations found when the test started, so you can confirm each one was played.
- **Download JSON**, **Copy text summary**, and **Print** for audit records. Saved JSON files can be reopened from **All reports**.

The last 15 reports are kept in the extension's local storage. Nothing is sent anywhere.

## What it measures

All thresholds come from the WCAG 2.2 Understanding document for 2.3.1 and live in one place, `WCAG22` in [src/engine.js](src/engine.js).

| Rule | Value |
|---|---|
| Relative luminance | WCAG 2.2 formula, sRGB threshold 0.04045 (2.0 used 0.03928) |
| General flash transition | Luminance change of 0.1 or more, with the darker state below 0.80 |
| Red flash transition | Change of more than 0.2 in CIE 1976 u'v' where one state has R/(R+G+B) of 0.8 or more (new in WCAG 2.2) |
| Flash | Two opposing transitions |
| Frequency limit | More than 6 transitions (3 flashes) in any one second fails |
| Area limit | More than 25% of any 341 by 256 CSS pixel area (21,824 CSS px) flashing at once fails |

### How it works

1. Chrome's tab capture streams the visible tab at up to 60 frames per second to a hidden offscreen document.
2. Each frame is reduced to cells of 4 by 4 CSS pixels. Colors are converted to linear light before averaging, so each cell's luminance is accurate. Detail smaller than a cell averages out, which matches the WCAG note that checkerboards with squares under 0.1 degree (about 3.4 CSS px) do not count.
3. Each cell tracks luminance and chromaticity over time. A transition counts once a change in one direction passes the threshold, so slow fades spread across many frames are still caught and small wobbles are ignored.
4. A cell is "flashing too fast" when it has more than 6 transitions in the last second.
5. On every frame, a 341 by 256 CSS pixel window slides across the page. If fast flashing cells cover more than 25% of any window position, that frame fails.

### Differences from PEAT and flash-guard

- **WCAG 2.2 red flash.** PEAT uses the older Harding red value (320 x (R - G - B)). This tool uses the WCAG 2.2 u'v' chromaticity definition. [flash-guard](https://github.com/zz-plant/flash-guard) also uses the older red rule.
- **CSS pixel area.** The area limit is a fixed 341 by 256 CSS pixels, as the 2.2 Understanding document describes, instead of a fraction of the screen. flash-guard uses one third of each screen axis, which is larger, and more permissive, on wide windows.
- **Per-cell frequency, then area.** Each area must itself flash too fast, and those areas must together exceed the area limit. This avoids counting unrelated changes in different parts of the page as one flash.
- **Live web pages.** No screen recording or export step.

## Limits

- It only tests what was on screen during the recording, at that window size and zoom. Test each state of the page that can flash.
- Video must actually play. Some sites block tab capture of DRM-protected video (it records as black), so test those with the provider's own tools.
- Frame rates below about 20 per second can miss fast flashing. The report flags this.
- Content at exactly 3 flashes per second sits on the boundary. Small timing differences in capture can push it either way, so treat those results as needing review.
- Saturated red: near-black colors (linear R+G+B under 0.01) are treated as black. Otherwise a barely visible dark red would count as saturated red. This is an implementation choice, noted in the report thresholds.
- Results support an expert review. A pass is not a medical safety guarantee.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `src/engine.js` | Flash analysis engine. No browser APIs; runs in Node for tests |
| `src/capture.js` | Reads a video stream frame by frame into the engine |
| `src/offscreen.*` | Hidden document that holds the tab capture |
| `src/background.js` | Service worker: runs the test, saves results, sets the badge |
| `src/verdict.js` | Turns results into Fail, Pass, or Needs review |
| `src/content.js` | Injected into the tested page: viewport size, scroll log, element lookup, overlay |
| `src/popup.*` | Toolbar popup |
| `src/report.*` | Report page and report history |
| `test/engine.test.mjs` | Engine unit tests with synthetic frames |
| `test-pages/flash-demos.html` | Flashing demos with known outcomes (contains a seizure warning; nothing flashes until started) |
| `test-pages/harness.html` | Runs every demo through the capture pipeline on a hidden canvas and compares with expected results |
| `test-pages/sample-report.json` | Synthetic report for previewing the report page |
| `scripts/` | Icon generator, sample report generator, PNG encoder |

## Development

Requires Node 18 or later. No dependencies.

```bash
npm test
```

To try the test pages, serve the folder (ES modules do not load from `file://`):

```bash
python3 -m http.server 8231 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8231/test-pages/harness.html` and select **Run all scenarios**, or open `http://127.0.0.1:8231/src/report.html?file=../test-pages/sample-report.json` to preview the report.

Other scripts: `npm run icons` rebuilds the icons; `node scripts/make-sample-report.mjs` rebuilds the sample report.
