import { statusTone } from "../services/api.js";

export default function StatusBadge({ status, children }) {
  const tone = statusTone(status);
  return <span className={`status-badge ${tone}`}>{children || status}</span>;
}
