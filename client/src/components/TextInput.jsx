import { INPUT_CLASS } from '../utils/ui.js';

/** Themed text/date/time/password input using {@link INPUT_CLASS}. */
export default function TextInput({ className = '', ...props }) {
  return <input className={`${INPUT_CLASS} ${className}`.trim()} {...props} />;
}
