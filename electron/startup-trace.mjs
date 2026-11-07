/** Milestones of one launch, in ms since the process started, written to the log once the window shows. */
export function createStartupTrace({ now = () => performance.now(), log }) {
  const marks = [];
  let done = false;
  const mark = (name) => {
    if (done || marks.some(([seen]) => seen === name)) return;
    marks.push([name, Math.round(now())]);
  };
  const finish = (name) => {
    if (done) return;
    mark(name);
    done = true;
    log(`startup: ${marks.map(([seen, at]) => `${seen} ${at}ms`).join(", ")}`);
  };
  return { mark, finish, marks: () => marks.map(([name, at]) => ({ name, at })) };
}
