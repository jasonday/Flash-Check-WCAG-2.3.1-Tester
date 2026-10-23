# Flash Check privacy policy

**Effective date:** October 23, 2026

Flash Check: WCAG 2.3.1 Tester ("Flash Check") is a Chrome extension that tests web pages for flashing content. This policy explains what the extension handles and where that information goes.

## The short version

Flash Check does not collect, sell, or share any data. It has no servers, accounts, analytics, or tracking. Everything it handles stays in your browser on your device.

## What Flash Check handles, and only when you start a test

| Information | Why it's needed | Where it goes |
|---|---|---|
| Video of the tab you're testing (no audio) | To measure flashing frame by frame | Analyzed in memory as it arrives, then discarded. It is never saved, replayed, or sent anywhere. |
| One still frame for each failure found | To show where the failure appeared in the report | Saved in your browser as part of the report |
| The page's address and title | To label the report | Saved in your browser as part of the report |
| The window size, scroll times during the test, and descriptions of page elements under failing areas (CSS selectors and labels) | To locate failures and name their likely source | Saved in your browser as part of the report |
| Your test settings (recording length and display options) | To remember your choices | Saved in your browser |

Flash Check does nothing on a page until you select its toolbar button and start a test. It works only on the tab where you started it.

## Storage and deletion

Reports and settings are kept in the extension's local storage in Chrome on your device. Flash Check keeps only your 15 most recent reports and deletes older ones automatically. Removing the extension from Chrome deletes all of its stored data.

## Sharing

Flash Check never sends data to the developer or anyone else. A report leaves your device only if you choose to download it as a file, copy its text summary, or print it.

## Permissions

- **activeTab:** access to the tab where you select the toolbar button, and no other tab
- **tabCapture:** records that tab's video during a test
- **offscreen:** runs the analysis in a hidden page so recording continues after the popup closes
- **scripting:** adds a small measuring script to the page you're testing
- **storage:** saves your settings and recent reports on your device

## Children

Flash Check is a professional testing tool. It does not knowingly handle information from children, and it collects no personal information from anyone.

## Changes to this policy

If this policy changes, the updated version will be posted here with a new effective date.

## Contact

For questions about this policy, open an issue at [the Flash Check issue tracker on GitHub](https://github.com/jasonday/Flash-Check-WCAG-2.3.1-Tester/issues).
