import { useMemo } from 'react';
import { Settings } from 'lucide-react';
import LightChipDropdown from './LightChipDropdown.jsx';
import { variantLabel } from '../utils/models.js';

/**
 * Cursor model variant picker (vertical list menu).
 *
 * @param {'text' | 'icon'} trigger — label + chevron, or settings icon only (chat bar)
 */
export default function CursorVariantDropdown({
  variants = [],
  modelDisplayName,
  variantIdx,
  onVariantIdxChange,
  disabled = false,
  placement = 'top-start',
  trigger = 'text',
  triggerClassName = '',
}) {
  const options = useMemo(
    () =>
      variants.map((v, i) => ({
        value: String(i),
        label: variantLabel(v, modelDisplayName),
        detail: v.is_default ? 'default' : undefined,
      })),
    [variants, modelDisplayName]
  );

  const value = variantIdx != null && variants[variantIdx] != null ? String(variantIdx) : '';

  const selectedVariant = variantIdx != null ? variants[variantIdx] : null;
  const label = selectedVariant
    ? variantLabel(selectedVariant, modelDisplayName)
    : 'Select variant';

  if (!variants.length) return null;

  return (
    <LightChipDropdown
      layout="list"
      value={value}
      onChange={(v) => onVariantIdxChange(Number(v))}
      options={options}
      selectedDisplay={{
        label,
        icon: trigger === 'icon' ? <Settings className="w-3.5 h-3.5" strokeWidth={2} /> : null,
      }}
      disabled={disabled}
      ariaLabel="Choose variant"
      placement={placement}
      triggerTitle={label}
      iconOnly={trigger === 'icon'}
      hideChevron={trigger === 'icon'}
      triggerClassName={
        trigger === 'icon'
          ? `p-1.5 rounded-md text-faint hover:text-secondary hover:bg-control/80 leading-none ${triggerClassName}`
          : `text-xs text-faint hover:text-secondary max-w-[14rem] ${triggerClassName}`
      }
    />
  );
}
