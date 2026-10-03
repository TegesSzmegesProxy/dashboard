export interface TagProps {
  children?: React.ReactNode;
  /** mono (default) for routes, rules, IPs; sans for plain words */
  mono?: boolean;
  onRemove?: () => void;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): JSX.Element;
