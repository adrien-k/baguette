import { useState, useEffect } from 'react';

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
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      autoComplete="off"
    />
  );
}
