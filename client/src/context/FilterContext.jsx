import { createContext, useContext } from 'react';
import { usePersistentState } from '../hooks/usePersistentState.js';

const FilterContext = createContext(null);

export function FilterProvider({ children }) {
  const persistent = usePersistentState('filters');
  const [showArchived, setShowArchived] = persistent.useState('showArchived', false);
  // Loop runs are ordinary sessions and show by default; the toggle is there for loops that
  // fire often enough to bury everything else.
  const [showLoopRuns, setShowLoopRuns] = persistent.useState('showLoopRuns', true);

  return (
    <FilterContext.Provider
      value={{ showArchived, setShowArchived, showLoopRuns, setShowLoopRuns }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  return useContext(FilterContext);
}
