/** The tessera: a notched entry ticket with a terracotta stub and pixel numeral. Brand motif for request receipts, API keys, plan cards. */
export interface TicketProps {
  /** Roman numeral or short code on the stub, pixel font */
  numeral?: string;
  /** tiny label under the numeral, e.g. "row" or "gate" */
  label?: string;
  title: string;
  meta?: string;
  status?: 'passed' | 'blocked' | 'review' | 'jev';
  style?: React.CSSProperties;
}
export declare function Ticket(props: TicketProps): JSX.Element;
