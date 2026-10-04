export interface TabItem { id: string; label: string; count?: number | string }
export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  /** underline (page sections) or pill (segmented, compact filters) */
  variant?: 'underline' | 'pill';
  style?: React.CSSProperties;
}
export declare function Tabs(props: TabsProps): JSX.Element;
