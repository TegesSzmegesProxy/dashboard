export interface TerminalLine {
  /** cmd = prompt line; out/code = highlighted; block/pass/jev/warn = verdict lines; comment = dim */
  kind?: 'cmd' | 'out' | 'code' | 'comment' | 'block' | 'pass' | 'jev' | 'warn';
  text: string;
}
/**
 * Ink terminal window for policies, payloads and CLI output. Square window dots, mono 13/1.65.
 * @startingPoint section="Data" subtitle="Syntax-highlighted policy terminal" viewport="700x340"
 */
export interface TerminalProps {
  title?: string;
  lines: Array<TerminalLine | string>;
  highlight?: boolean;
  style?: React.CSSProperties;
}
export declare function Terminal(props: TerminalProps): JSX.Element;
