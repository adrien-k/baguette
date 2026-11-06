import { useState, useEffect } from 'react';

import { INPUT_CLASS } from '../utils/ui.js';

export default function MaskedSecretInput({ maskedValue, placeholder, onChange }) {
  const [value, setValue] = useState(maskedValue || '');
  const [isDirty, setIsDirty] = useState(false);
  /** True once the user actually typed during the current edit epoch.
   * Focus-then-blur alone must not read as "cleared it": focus auto-empties
   * the field so a masked value can be replaced, so a plain blur with no
   * keystrokes reports unchanged. Clearing a stored secret requires an
   * explicit edit: type and empty the field, then save.
   */
  const [userEdited, setUserEdited] = useState(false);

  useEffect(() => {
    setValue(maskedValue || '');
    setIsDirty(false);
    setUserEdited(false);
  }, [maskedValue]);

  const handleFocus = () => {
    setUserEdited(false);
    if (!isDirty) setValue('');
  };

  const handleChange = (e) => {
    setUserEdited(true);
    setValue(e.target.value);
  };

  const handleBlur = () => {
    setIsDirty(true);
    onChange(value, userEdited);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setValue(maskedValue || '');
      setIsDirty(false);
      setUserEdited(false);
      onChange(null, false);
      e.target.blur();
    }
  };

  return (
    <input
      type="password"
      value={value}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={maskedValue ? '(change to update)' : placeholder}
      className={`${INPUT_CLASS} font-mono`}
      autoComplete="off"
    />
  );
}
