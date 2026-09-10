/**
 * The figure on the sign-in panel.
 *
 * A body performing a shoulder abduction - one of the exercises in the
 * library - drawn with the same joints, the same teal and the same line
 * weights as the skeleton `PoseOverlay` puts over a patient during a real
 * session. The marketing surface and the product surface therefore speak the
 * same visual language: someone who has never signed in learns what the
 * application does, and someone who has recognises the view they are about to
 * be in.
 *
 * The animation lives in `index.css`, where each limb rotates about the joint
 * above it. Reduced-motion readers get the same drawing, held still at the
 * start of the movement, because the figure has to explain the product whether
 * or not it is allowed to move.
 */

/** Joint positions at the bottom of the movement, in the SVG's own units. */
const JOINTS: Array<[number, number]> = [
  [100, 42], // head centre
  [74, 78], // left shoulder
  [126, 78], // right shoulder
  [100, 150], // pelvis centre
  [82, 150], // left hip
  [118, 150], // right hip
  [78, 198], // left knee
  [122, 198], // right knee
  [76, 244], // left ankle
  [124, 244], // right ankle
];

export function PoseFigure({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 -30 200 300"
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="A figure raising both arms out to the sides and overhead, with its joints tracked"
    >
      {/*
        The range each wrist travels. Dashed and faint: it is the measurement
        the exercise is about, drawn behind the body rather than over it.
      */}
      <path
        d="M 64 152 A 74.7 74.7 0 0 1 62 6"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeDasharray="2 7"
        className="opacity-30"
      />
      <path
        d="M 136 152 A 74.7 74.7 0 0 0 138 6"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeDasharray="2 7"
        className="opacity-30"
      />

      <g stroke="currentColor" strokeWidth={5} className="opacity-90">
        {/* head */}
        <circle cx="100" cy="42" r="15" />
        {/* neck and spine */}
        <path d="M100 57 V 150" />
        {/* shoulder and hip girdles */}
        <path d="M74 78 H 126" />
        <path d="M82 150 H 118" />
        {/* legs */}
        <path d="M82 150 L 78 198 L 76 244" />
        <path d="M118 150 L 122 198 L 124 244" />

        {/* left arm: upper arm rotates at the shoulder, forearm at the elbow */}
        <g className="limb arm-upper-left">
          <path d="M74 78 L 68 116" />
          <g className="limb arm-fore-left">
            <path d="M68 116 L 64 152" />
          </g>
        </g>

        {/* right arm */}
        <g className="limb arm-upper-right">
          <path d="M126 78 L 132 116" />
          <g className="limb arm-fore-right">
            <path d="M132 116 L 136 152" />
          </g>
        </g>
      </g>

      {/*
        Tracked landmarks, drawn exactly as the live overlay draws them: a
        filled dot ringed in the tracking colour. Only the joints that stay put
        during the movement are marked - a dot left behind at a shoulder while
        the arm has swung away would be wrong, and following the moving joints
        would mean duplicating the animation here.
      */}
      <g>
        {JOINTS.map(([x, y]) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={4}
            fill="currentColor"
            className="opacity-95"
          />
        ))}
      </g>
    </svg>
  );
}
