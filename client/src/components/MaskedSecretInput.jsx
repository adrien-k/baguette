import { useState, useEffect } from 'react';

import { INPUT_CLASS } from '../utils/ui.js';

export default function MaskedSecretInput({ maskedValue, placeholder, onChange }) {
  const [value, setValue] = useState(maskedValue || '');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setValue(maskedValue || '');
    setIsDirty(false);
  }, [maskedValue]);

  const handleFocus = () => {
    if (!isDirty) setValue('');
  };

  const handleChange = (e) => setValue(e.target.value);

  const handleBlur = () => {
    setIsDirty(true);
    onChange(value, true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setValue(maskedValue || '');
      setIsDirty(false);
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
