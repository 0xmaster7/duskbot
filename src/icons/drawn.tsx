import type { ReactNode, SVGProps } from "react";
import type { Svg } from "./glyph";

// gravity ui's cloud outline and handset (MIT), reused under our marks
const CLOUD = "M4.5 6.25a3.25 3.25 0 0 1 6.398-.811.75.75 0 0 0 .702.563A3 3 0 0 1 11.5 12H3.75a2.25 2.25 0 0 1-.002-4.5h.03a.75.75 0 0 0 .747-.843A3 3 0 0 1 4.5 6.25M7.75 1.5a4.75 4.75 0 0 0-4.747 4.574A3.751 3.751 0 0 0 3.75 13.5h7.75a4.5 4.5 0 0 0 .687-8.948A4.75 4.75 0 0 0 7.75 1.5";
const HANDSET = "M14.125 9.833a3.7 3.7 0 0 0-1.592-1.22l-.032-.012a2.88 2.88 0 0 0-2.795.37l-.36.269a.5.5 0 0 1-.653-.047L6.807 7.307a.5.5 0 0 1-.047-.654l.27-.36A2.88 2.88 0 0 0 7.4 3.5l-.013-.032a3.7 3.7 0 0 0-1.22-1.592l-.19-.143a2.33 2.33 0 0 0-2.135-.346l-.19.063A3.48 3.48 0 0 0 1.45 3.653a4.9 4.9 0 0 0-.105 2.725 9.76 9.76 0 0 0 2.567 4.533l1.178 1.178a9.76 9.76 0 0 0 4.533 2.566c.9.226 1.845.19 2.725-.104a3.48 3.48 0 0 0 2.204-2.203l.063-.19a2.33 2.33 0 0 0-.347-2.135zM5.159 3.219l-.19-.143a.65.65 0 0 0-.596-.096l-.19.063c-.538.18-.96.602-1.14 1.14a3.2 3.2 0 0 0-.069 1.788A8.1 8.1 0 0 0 5.1 9.723l1.178 1.178a8.1 8.1 0 0 0 3.752 2.125c.59.147 1.21.123 1.787-.069.539-.18.961-.602 1.141-1.14l.063-.19a.65.65 0 0 0-.096-.596l-.143-.19a2.03 2.03 0 0 0-.872-.668l-.032-.013a1.2 1.2 0 0 0-1.163.154l-.36.27a2.18 2.18 0 0 1-2.849-.203L5.62 8.495a2.18 2.18 0 0 1-.203-2.85l.27-.36c.25-.334.309-.774.154-1.162l-.013-.032a2.03 2.03 0 0 0-.668-.872";
const SPARKLE = "M7 1.5C6.45 4.8 4.8 6.45 1.5 7c3.3.55 4.95 2.2 5.5 5.5.55-3.3 2.2-4.95 5.5-5.5C9.2 6.45 7.55 4.8 7 1.5M7 0a1.5 1.5 0 0 1 1.48 1.253c.242 1.455.696 2.364 1.3 2.968.603.603 1.512 1.057 2.967 1.3a1.5 1.5 0 0 1 0 2.958c-1.455.243-2.364.697-2.968 1.3-.603.604-1.057 1.513-1.3 2.968a1.5 1.5 0 0 1-2.958 0c-.243-1.455-.697-2.364-1.3-2.968-.604-.603-1.513-1.057-2.968-1.3a1.5 1.5 0 0 1 0-2.958c1.455-.243 2.364-.697 2.968-1.3.603-.604 1.057-1.513 1.3-2.968l.028-.133A1.5 1.5 0 0 1 7 0";
const SPARKLE_SOLID = "M7 0a1 1 0 0 1 .986.836c.279 1.67.815 2.8 1.596 3.582.781.781 1.912 1.317 3.582 1.596a1 1 0 0 1 0 1.972c-1.67.279-2.8.815-3.582 1.596-.781.781-1.317 1.912-1.596 3.582a1 1 0 0 1-1.972 0c-.279-1.67-.815-2.8-1.596-3.582-.781-.781-1.912-1.317-3.582-1.596a1 1 0 0 1 0-1.972c1.67-.279 2.8-.815 3.582-1.596.781-.781 1.317-1.912 1.596-3.582l.018-.089A1 1 0 0 1 7 0";

function draw(art: ReactNode): Svg {
  return (props: SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 16 16" fill="none" {...props}>
      <g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{art}</g>
    </svg>
  );
}

function shape(art: ReactNode): Svg {
  return (props: SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 16 16" fill="none" {...props}>
      {art}
    </svg>
  );
}

const ink = { fill: "currentColor", stroke: "none" } as const;

export const Laptop = draw(<><rect x={2.75} y={2.75} width={10.5} height={7.5} rx={1.75} /><path d="M1.25 13.25h13.5" /></>);

export const Waveform = draw(<path d="M2 6.75v2.5M5 4.25v7.5M8 1.75v12.5M11 4.75v6.5M14 6.75v2.5" />);

export const Building = draw(
  <path d="M1.25 14.25h13.5M2.75 14.25v-10.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v10.5M10.75 6.25h1.25a1.25 1.25 0 0 1 1.25 1.25v6.75M5.5 5h2.5M5.5 8h2.5M5.5 11h2.5" />,
);

export const Spinner = draw(<path d="M8 1.75A6.25 6.25 0 1 0 14.25 8" />);

export const ArchiveRestore = draw(
  <><rect x={1.75} y={2.25} width={12.5} height={3.5} rx={1.25} /><path d="M2.75 5.75v6a2.5 2.5 0 0 0 2.5 2.5h5.5a2.5 2.5 0 0 0 2.5-2.5v-6M8 12V8.5M6.25 10 8 8.25 9.75 10" /></>,
);

export const Brain = draw(
  <path d="M8 3.25a2.25 2.25 0 0 0-4.2-.9A2.25 2.25 0 0 0 2.4 6a2.5 2.5 0 0 0 .1 4.25A2.5 2.5 0 0 0 5.5 13.6 2.25 2.25 0 0 0 8 12.5zm0 0a2.25 2.25 0 0 1 4.2-.9A2.25 2.25 0 0 1 13.6 6a2.5 2.5 0 0 1-.1 4.25 2.5 2.5 0 0 1-3 3.35A2.25 2.25 0 0 1 8 12.5M5 6.75a1.75 1.75 0 0 0 3 0m0 0a1.75 1.75 0 0 0 3 0" />,
);

const calendar = <><rect x={1.75} y={2.75} width={12.5} height={11.5} rx={2.25} /><path d="M5 1.25v2.5M11 1.25v2.5M1.75 6.25h12.5" /></>;
export const CalendarCheck = draw(<>{calendar}<path d="m5.75 10 1.5 1.5 3-3" /></>);
export const CalendarClock = draw(<>{calendar}<path d="M8 8.5V10l1.25.75" /><circle cx={8} cy={10.25} r={2.5} /></>);

export const CircleDot = draw(<><circle cx={8} cy={8} r={6.25} /><circle cx={8} cy={8} r={1.75} {...ink} /></>);

export const Dot = draw(<circle cx={8} cy={8} r={2} {...ink} />);

const board = <><path d="M5.25 2.75h-.5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h6.5a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2h-.5" /><rect x={5.75} y={1.25} width={4.5} height={3} rx={1} /></>;
export const Clipboard = draw(board);
export const ClipboardList = draw(<>{board}<path d="M5.75 8h4.5M5.75 10.75h3" /></>);
export const ClipboardPaste = draw(<>{board}<path d="M8 7v4.5M6.25 9.75 8 11.5l1.75-1.75" /></>);

const cloud = <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={CLOUD} />;
export const CloudAlert = shape(<>{cloud}<path stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" d="M8 6.25v2.25" /><circle cx={8} cy={10.25} r={0.875} {...ink} /></>);
export const CloudDownload = shape(<>{cloud}<path stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" d="M8 5.75v4.5M6.25 8.5 8 10.25 9.75 8.5" /></>);

export const Command = draw(
  <path d="M6 6H4.5A1.75 1.75 0 1 1 6 4.25zm4 0h1.5A1.75 1.75 0 1 0 10 4.25zM6 10H4.5A1.75 1.75 0 1 0 6 11.75zm4 0h1.5A1.75 1.75 0 1 1 10 11.75zM6 6h4v4H6z" />,
);

export const IdCard = draw(
  <><rect x={1.75} y={3.25} width={12.5} height={9.5} rx={2.25} /><circle cx={5.75} cy={7} r={1.25} /><path d="M4 10.25c.75-1 2.75-1 3.5 0M9.75 6.75h2.5M9.75 9.25h1.75" /></>,
);

export const CornerDownRight = draw(<path d="M3 2.75v4.5a2.5 2.5 0 0 0 2.5 2.5h7.5M10 6.75l3 3-3 3" />);

export const Crosshair = draw(<><circle cx={8} cy={8} r={5.5} /><path d="M8 1.25v3M8 11.75v3M1.25 8h3M11.75 8h3" /></>);

export const GridPlus = draw(
  <><rect x={2.25} y={2.25} width={4.5} height={4.5} rx={1.25} /><rect x={9.25} y={2.25} width={4.5} height={4.5} rx={1.25} /><rect x={2.25} y={9.25} width={4.5} height={4.5} rx={1.25} /><path d="M11.5 9v5M9 11.5h5" /></>,
);

export const ImageOff = draw(
  <path d="M5.5 2.25h6a2.25 2.25 0 0 1 2.25 2.25v6M12.5 13.4a2.2 2.2 0 0 1-1 .35h-7a2.25 2.25 0 0 1-2.25-2.25v-7c0-.4.1-.75.3-1.05M2.5 11.25 5.5 9l2 1.5M1.75 1.75l12.5 12.5" />,
);
export const ImagePlus = draw(
  <><path d="M13.75 7.5v-3a2.25 2.25 0 0 0-2.25-2.25h-7A2.25 2.25 0 0 0 2.25 4.5v7a2.25 2.25 0 0 0 2.25 2.25h3M2.5 11.25 5.5 9l2 1.5M12.25 9.75v5M9.75 12.25h5" /><circle cx={5.75} cy={5.75} r={1.25} /></>,
);

export const FoldedMap = draw(<path d="M1.75 4.25 5.75 2.25l4.5 2 4-2v9.5l-4 2-4.5-2-4 2zM5.75 2.25v9.5M10.25 4.25v9.5" />);

const screen = <><rect x={1.75} y={2.25} width={12.5} height={8.5} rx={2.25} /><path d="M8 10.75v3M5 13.75h6" /></>;
export const DisplayX = draw(<>{screen}<path d="m6.5 5.25 3 2.5m0-2.5-3 2.5" /></>);
export const DisplayGear = draw(<>{screen}<circle cx={8} cy={6.5} r={1.25} /><path d="M8 3.75v.5M8 8.75v.5M5.25 6.5h.5M10.25 6.5h.5" /></>);
const phone = <><rect x={10.25} y={6.75} width={4.5} height={7.5} rx={1.25} /><path d="M12.5 12.25h0" /></>;
export const DisplayPhone = draw(<><path d="M12.75 4.75V4a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2H8M5.75 10.5v3.25M4 13.75h4" />{phone}</>);
export const TabletPhone = draw(<><path d="M8 14.25H3.75a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v1" />{phone}</>);

export const Pointer = draw(<path d="m2.75 2.75 10.5 4.25-4.5 1.75-1.75 4.5z" />);
export const PointerClick = draw(<path d="m6.75 6.75 7 2.75-3 1.25-1.25 3zM4.5 1.5v1.5M1.5 4.5H3M2.25 2.25l1 1M7.25 2.25l-1 1M2.25 7.25l1-1" />);

export const Popper = draw(<path d="M1.75 14.25 4.5 6l5.5 5.5zM9.25 1.75v1M14.25 6.75v1M11 5l2-2M7.5 5.5c.5-1 .5-2 0-3M10.5 8.5c1-.5 2-.5 3 0" />);

export const HangUp = shape(<path fill="currentColor" fillRule="evenodd" clipRule="evenodd" transform="rotate(135 8 8)" d={HANDSET} />);

const corners = "M1.75 5V3.75a2 2 0 0 1 2-2H5M11 1.75h1.25a2 2 0 0 1 2 2V5M14.25 11v1.25a2 2 0 0 1-2 2H11M5 14.25H3.75a2 2 0 0 1-2-2V11";
export const Scan = draw(<path d={corners} />);
export const ScanLine = draw(<path d={`${corners}M4.75 8h6.5`} />);
export const CornersIn = draw(
  <path d="M5.25 1.75v1.5a2 2 0 0 1-2 2h-1.5M10.75 1.75v1.5a2 2 0 0 0 2 2h1.5M14.25 10.75h-1.5a2 2 0 0 0-2 2v1.5M1.75 10.75h1.5a2 2 0 0 1 2 2v1.5" />,
);

export const Sparkle = shape(<path fill="currentColor" transform="translate(1 1)" d={SPARKLE} />);
export const SparkleSolid = shape(<path fill="currentColor" transform="translate(1 1)" d={SPARKLE_SOLID} />);

export const SquareSlash = draw(<><rect x={1.75} y={1.75} width={12.5} height={12.5} rx={2.75} /><path d="m9.75 5-3.5 6" /></>);

export const WrapText = draw(<path d="M2 3.75h12M2 8h9.5a2.25 2.25 0 0 1 0 4.5H8.5M10 11l-1.5 1.5L10 14M2 12.25h3.5" />);

const torch = "M5 1.75h6v2.5L9.75 6.5v7a.75.75 0 0 1-.75.75H7a.75.75 0 0 1-.75-.75v-7L5 4.25zM8 9v1.5";
export const Torch = draw(<path d={torch} />);
export const TorchOff = draw(<path d={`${torch}M2 2l12 12`} />);

export const FolderMinus = draw(
  <path d="M1.75 4a1.75 1.75 0 0 1 1.75-1.75h2.6l1.65 1.5h4.75a1.75 1.75 0 0 1 1.75 1.75v6.5a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 12zM6 8.75h4" />,
);

export const Atom = draw(
  <><ellipse cx={8} cy={8} rx={6.5} ry={2.5} /><ellipse cx={8} cy={8} rx={6.5} ry={2.5} transform="rotate(60 8 8)" /><ellipse cx={8} cy={8} rx={6.5} ry={2.5} transform="rotate(-60 8 8)" /><circle cx={8} cy={8} r={1} {...ink} /></>,
);
