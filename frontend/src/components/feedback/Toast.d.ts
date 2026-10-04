export interface ToastProps {
  status?: 'blocked' | 'passed' | 'review' | 'info';
  title: string;
  message?: string;
  /** mono footnote — request id, timestamp */
  meta?: string;
  onClose?: () => void;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;
