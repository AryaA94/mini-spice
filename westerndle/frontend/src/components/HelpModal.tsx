import { Modal } from "./Modal";
import { Tile } from "./Tile";

export function HelpModal({ maxGuesses, onClose }: { maxGuesses: number; onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          Guess today's mystery <b>Western University</b> building in {maxGuesses} tries. Every guess tells you how
          close you are.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <Tile label="Zone" value="Core" match="correct" />
          <Tile label="Built" value={1969} match="close" hint="higher" />
          <Tile label="Type" value="Library" match="wrong" />
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-purple-western dark:text-purple-300">Purple</b>: exact match.</li>
          <li><b className="text-close">Gold</b>: close — within 10 years built, or 1 floor.</li>
          <li><b>▲ / ▼</b>: the answer is higher or lower.</li>
          <li>The distance and arrow point from your guess to the answer. <b>Near</b> is how close you are across campus.</li>
        </ul>
        <p>A new building every day at midnight (London, ON time). Practice mode gives unlimited random buildings.</p>
        <p className="text-xs text-silver">Fan-made. Not affiliated with or endorsed by Western University.</p>
      </div>
    </Modal>
  );
}
