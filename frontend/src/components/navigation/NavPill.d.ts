/** Floating capsule nav with square dot separators — the marketing-site header centrepiece. */
export interface NavPillProps {
  items: string[];
  active?: string;
  onSelect?: (item: string) => void;
  /** light = bone glass, dark = ink glass */
  tone?: 'light' | 'dark';
  style?: React.CSSProperties;
}
export declare function NavPill(props: NavPillProps): JSX.Element;
