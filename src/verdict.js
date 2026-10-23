// Overall result for a run. "review" means the tool found something it
// can't settle alone.
export function verdict(run) {
  const events = [...run.general.events, ...run.red.events];
  const reasons = [];
  const clean = events.filter((e) => !e.duringScroll);
  if (clean.length) {
    const kinds = [run.general.events.some((e) => !e.duringScroll) && 'general flash', run.red.events.some((e) => !e.duringScroll) && 'red flash'].filter(Boolean);
    return { level: 'fail', summary: `Fails 2.3.1: ${kinds.join(' and ')} above the threshold.`, reasons };
  }
  if (events.length) reasons.push('Flashing above the threshold happened only while the page was scrolling. Scrolling can look like flashing. Run again without scrolling.');
  if (run.stats.frames < 2 || run.stats.changedFrames === 0) reasons.push('Nothing on the page changed during capture. Start any video or animation and run again.');
  else if (run.stats.fps < 20) reasons.push(`Capture ran at about ${Math.round(run.stats.fps)} frames per second. Fast flashing can be missed below 20. Close other tabs or shorten the run and test again.`);
  if (run.stopReason === 'ended' || run.navigatedAway) reasons.push('The tab closed or navigated during capture, so part of the content may not have been tested.');
  if (reasons.length) return { level: 'review', summary: 'Needs review. The capture could not give a reliable answer.', reasons };
  return { level: 'pass', summary: 'Passes 2.3.1 for the content shown during this capture.', reasons };
}
