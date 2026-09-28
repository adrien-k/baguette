import { useCallback, useRef, useState } from 'react';
import AnchoredMenu from '../AnchoredMenu.jsx';
import { useSearchableSelectAsync } from './useSearchableSelectAsync.js';
import { DROPDOWN_PANEL_CLASS } from '../../utils/dropdownPanel.js';

const COLOR_CLASSES = {
  amber: { ring: 'focus:ring-brand/50', border: 'border-brand/50' },
  violet: { ring: 'focus:ring-merged/50', border: 'border-merged/50' },
};

/**
 * Searchable select with a text input for filtering and a dropdown list.
 *
 * Props:
 *   value            – currently selected value (from getOptionValue)
 *   onChange(value)  – called with getOptionValue(option) on select, or '' on clear
 *   options          – static options (ignored when getOptions is set)
 *   getOptions       – optional async (query: string) => options; enables server-side
 *                      search with debouncing; query is the current input (may be '').
 *                      Should return an array; invalid rows (bad shape, duplicate keys,
 *                      getOptionValue/getOptionLabel errors) are dropped.
 *   getOptionsDebounceMs – debounce for getOptions when query is non-empty (default 300)
 *   asyncRefetchKey  – when getOptions is set, changing this value refetches the open panel (e.g. org id)
 *   loading          – external loading (e.g. parent fetching); combined with internal fetch state
 *   disabled         – disable input entirely
 *   color            – 'amber' | 'violet' (default 'amber')
 *   placeholder      – input placeholder when idle
 *   loadingText      – placeholder while loading
 *   emptyText        – placeholder when options is empty (and not loading)
 *   disabledText     – placeholder when disabled
 *   getOptionValue   – (option) => string key — default: identity (for string arrays)
 *   getOptionLabel   – (option) => string for filtering — default: String(option)
 *   renderOption     – (option) => ReactNode for dropdown row — default: getOptionLabel
 *   renderSelected   – (option) => ReactNode for selected display — default: getOptionLabel
 *   isOptionDisabled – optional (option) => boolean; disabled rows are shown but not selectable
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  getOptions,
  getOptionsDebounceMs = 300,
  asyncRefetchKey,
  loading = false,
  disabled = false,
  color = 'amber',
  placeholder = 'Search...',
  loadingText = 'Loading...',
  emptyText = 'No options',
  disabledText,
  getOptionValue = (o) => o,
  getOptionLabel = (o) => String(o),
  renderOption,
  renderSelected,
  isOptionDisabled,
}) {
  const [search, setSearch] = useState(null); // null means search is closed
  const inputRef = useRef(null);
  const isOpen = search !== null;
  const { ring, border } = COLOR_CLASSES[color] ?? COLOR_CLASSES.amber;

  const { fetchedOptions, asyncLoading, fetchForQuery, debouncedFetch, cancelDebouncedFetch } =
    useSearchableSelectAsync({
      getOptions,
      getOptionValue,
      getOptionLabel,
      getOptionsDebounceMs,
      asyncRefetchKey,
      search,
    });

  const primeAsyncEmptyQuery = useCallback(() => {
    if (!getOptions) return;
    cancelDebouncedFetch();
    void fetchForQuery('');
  }, [getOptions, cancelDebouncedFetch, fetchForQuery]);

  const listSource = getOptions ? fetchedOptions : options;
  /** Parent-driven loading only — never tie this to async fetches: disabling the input steals focus. */
  const inputDisabled = disabled || loading;
  const showLoadingPlaceholder = loading || (getOptions && asyncLoading);

  const filteredOptions = getOptions
    ? listSource
    : listSource.filter(
        (o) => !search || getOptionLabel(o).toLowerCase().includes(search.toLowerCase())
      );

  const selectedItem = value ? listSource.find((o) => getOptionValue(o) === value) : null;

  const closeSearch = useCallback(() => {
    setSearch(null);
    cancelDebouncedFetch();
  }, [cancelDebouncedFetch]);

  const inputPlaceholder =
    disabled && disabledText
      ? disabledText
      : showLoadingPlaceholder
        ? loadingText
        : listSource.length === 0
          ? emptyText
          : placeholder;

  const showClosedSelected = search === null && (selectedItem || value);

  const renderSelectedContent = () => {
    if (selectedItem) {
      return renderSelected ? renderSelected(selectedItem) : getOptionLabel(selectedItem);
    }
    return String(value);
  };

  const openSearchAndFocus = () => {
    setSearch('');
    primeAsyncEmptyQuery();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputChange = (next) => {
    setSearch(next);
    if (!getOptions) return;
    if (next === '') {
      primeAsyncEmptyQuery();
    } else {
      debouncedFetch(next);
    }
  };

  return (
    <AnchoredMenu
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeSearch();
      }}
      placement="bottom-start"
      matchReferenceWidth
      className={`max-h-48 overflow-y-auto ${DROPDOWN_PANEL_CLASS} divide-y divide-line`}
      reference={({ ref, referenceProps }) => (
        <div ref={ref} {...referenceProps} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={search ?? ''}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              if (search !== null) return;
              setSearch('');
              primeAsyncEmptyQuery();
            }}
            onClick={() => {
              if (search === null) {
                setSearch('');
                primeAsyncEmptyQuery();
              }
            }}
            placeholder={inputPlaceholder}
            disabled={inputDisabled}
            className={`w-full rounded-md border border-strong bg-control px-3 py-2.5 text-sm text-fg placeholder-faint focus:border-transparent focus:outline-none focus:ring-2 ${ring} disabled:opacity-50 ${
              showClosedSelected
                ? 'absolute inset-0 z-0 min-h-10.5 opacity-0 pointer-events-none'
                : 'relative'
            }`}
          />
          {showClosedSelected &&
            (disabled ? (
              <div
                className={`relative z-10 w-full rounded-md border ${border} bg-control px-3 py-2.5 text-sm text-fg opacity-50`}
              >
                {renderSelectedContent()}
              </div>
            ) : (
              <button
                type="button"
                onClick={openSearchAndFocus}
                className={`relative z-10 w-full rounded-md border ${border} bg-control px-3 py-2.5 text-sm text-fg text-left cursor-pointer focus:outline-none focus:ring-2 ${ring}`}
                aria-label="Change selection"
              >
                {renderSelectedContent()}
              </button>
            ))}
        </div>
      )}
    >
      {!disabled &&
        !loading &&
        filteredOptions.map((o) => {
          const optionDisabled = isOptionDisabled?.(o) ?? false;
          return (
            <button
              key={getOptionValue(o)}
              type="button"
              disabled={optionDisabled}
              onClick={() => {
                onChange(getOptionValue(o));
                closeSearch();
              }}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                optionDisabled ? 'text-faint cursor-not-allowed' : 'text-fg hover:bg-control/50'
              }`}
            >
              {renderOption ? renderOption(o) : getOptionLabel(o)}
            </button>
          );
        })}
    </AnchoredMenu>
  );
}
