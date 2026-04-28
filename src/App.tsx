import { FormEvent, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'card-sort-state-v1';
const SHARE_PARAM = 'state';
const canUseRandomUuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto;

type AppPhase = 'entry' | 'sorting' | 'done';

type Comparison = {
  candidateId: string;
  pivotId: string;
  winnerId: string;
};

type SortState = {
  version: 1;
  items: SortItem[];
  sortedIds: string[];
  pendingIds: string[];
  active: ActiveInsertion | null;
  comparisons: Comparison[];
  phase: AppPhase;
};

type SortItem = {
  id: string;
  label: string;
};

type ActiveInsertion = {
  itemId: string;
  low: number;
  high: number;
};

type ShareState = Pick<SortState, 'items' | 'sortedIds' | 'pendingIds' | 'active' | 'comparisons' | 'phase'>;

function createInitialState(): SortState {
  return {
    version: 1,
    items: [],
    sortedIds: [],
    pendingIds: [],
    active: null,
    comparisons: [],
    phase: 'entry',
  };
}

function createItem(label: string, index: number): SortItem {
  return {
    id: `${Date.now().toString(36)}-${index}-${
      canUseRandomUuid ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    }`,
    label,
  };
}

function normalizeItems(input: string): SortItem[] {
  const seen = new Set<string>();

  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((label) => {
      const key = label.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(createItem);
}

function startSorting(items: SortItem[]): SortState {
  if (items.length === 0) {
    return createInitialState();
  }

  if (items.length === 1) {
    return {
      ...createInitialState(),
      items,
      sortedIds: [items[0].id],
      phase: 'done',
    };
  }

  return {
    ...createInitialState(),
    items,
    sortedIds: [items[0].id],
    pendingIds: items.slice(1).map((item) => item.id),
    phase: 'sorting',
  };
}

function ensureActiveInsertion(state: SortState): SortState {
  if (state.phase !== 'sorting' || state.active) {
    return state;
  }

  const [nextPendingId, ...remainingPendingIds] = state.pendingIds;

  if (!nextPendingId) {
    return {
      ...state,
      phase: 'done',
    };
  }

  return {
    ...state,
    pendingIds: remainingPendingIds,
    active: {
      itemId: nextPendingId,
      low: 0,
      high: state.sortedIds.length,
    },
  };
}

function insertAt<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function recordChoice(state: SortState, winnerId: string): SortState {
  if (state.phase !== 'sorting' || !state.active) {
    return state;
  }

  const active = state.active;
  const pivotIndex = Math.floor((active.low + active.high) / 2);
  const pivotId = state.sortedIds[pivotIndex];
  const candidateWon = winnerId === active.itemId;
  const nextLow = candidateWon ? active.low : pivotIndex + 1;
  const nextHigh = candidateWon ? pivotIndex : active.high;
  const comparisons = [
    ...state.comparisons,
    {
      candidateId: active.itemId,
      pivotId,
      winnerId,
    },
  ];

  if (nextLow >= nextHigh) {
    const withInsertedItem = insertAt(state.sortedIds, nextLow, active.itemId);
    return ensureActiveInsertion({
      ...state,
      sortedIds: withInsertedItem,
      active: null,
      comparisons,
    });
  }

  return {
    ...state,
    active: {
      ...active,
      low: nextLow,
      high: nextHigh,
    },
    comparisons,
  };
}

function getCurrentPair(state: SortState): [SortItem, SortItem] | null {
  if (state.phase !== 'sorting' || !state.active) {
    return null;
  }

  const pivotIndex = Math.floor((state.active.low + state.active.high) / 2);
  const candidate = state.items.find((item) => item.id === state.active?.itemId);
  const pivot = state.items.find((item) => item.id === state.sortedIds[pivotIndex]);

  if (!candidate || !pivot) {
    return null;
  }

  return [candidate, pivot];
}

function getOrderedItems(state: SortState): SortItem[] {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  return state.sortedIds.map((id) => byId.get(id)).filter((item): item is SortItem => Boolean(item));
}

function sanitizeState(value: unknown): SortState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SortState>;
  if (!Array.isArray(candidate.items) || !Array.isArray(candidate.sortedIds) || !Array.isArray(candidate.pendingIds)) {
    return null;
  }

  const items = candidate.items.filter(
    (item): item is SortItem =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as SortItem).id === 'string' &&
      typeof (item as SortItem).label === 'string',
  );
  const itemIds = new Set(items.map((item) => item.id));
  const sortedIds = candidate.sortedIds.filter((id): id is string => typeof id === 'string' && itemIds.has(id));
  const pendingIds = candidate.pendingIds.filter((id): id is string => typeof id === 'string' && itemIds.has(id));
  const active =
    candidate.active &&
    typeof candidate.active === 'object' &&
    typeof candidate.active.itemId === 'string' &&
    itemIds.has(candidate.active.itemId) &&
    typeof candidate.active.low === 'number' &&
    typeof candidate.active.high === 'number'
      ? candidate.active
      : null;
  const phase: AppPhase =
    candidate.phase === 'sorting' || candidate.phase === 'done' || candidate.phase === 'entry'
      ? candidate.phase
      : items.length > 0
        ? 'sorting'
        : 'entry';

  return ensureActiveInsertion({
    version: 1,
    items,
    sortedIds,
    pendingIds,
    active,
    comparisons: Array.isArray(candidate.comparisons) ? candidate.comparisons : [],
    phase,
  });
}

function encodeShareState(state: SortState): string {
  const shareState: ShareState = {
    items: state.items,
    sortedIds: state.sortedIds,
    pendingIds: state.pendingIds,
    active: state.active,
    comparisons: state.comparisons,
    phase: state.phase,
  };
  const json = JSON.stringify(shareState);
  const bytes = new TextEncoder().encode(json);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeShareState(encoded: string): SortState | null {
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return sanitizeState(JSON.parse(json));
  } catch {
    return null;
  }
}

function loadInitialState(): SortState {
  const params = new URLSearchParams(window.location.search);
  const sharedState = params.get(SHARE_PARAM);

  if (sharedState) {
    const decoded = decodeShareState(sharedState);
    if (decoded) {
      return decoded;
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeState(JSON.parse(stored)) ?? createInitialState() : createInitialState();
  } catch {
    return createInitialState();
  }
}

function App() {
  const [state, setState] = useState<SortState>(() => ensureActiveInsertion(loadInitialState()));
  const [rawItems, setRawItems] = useState(() => {
    const initialState = loadInitialState();
    return initialState.items.map((item) => item.label).join('\n');
  });
  const [shareUrl, setShareUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const currentPair = getCurrentPair(state);
  const orderedItems = useMemo(() => getOrderedItems(state), [state]);
  const totalItems = state.items.length;
  const placedItems = state.sortedIds.length;
  const completedComparisons = state.comparisons.length;
  const progress = totalItems <= 1 ? 100 : Math.min(100, Math.round((placedItems / totalItems) * 100));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = normalizeItems(rawItems);
    setShareUrl('');
    setCopyStatus('');
    setState(ensureActiveInsertion(startSorting(items)));
  }

  function handleChoose(winnerId: string) {
    setShareUrl('');
    setCopyStatus('');
    setState((currentState) => recordChoice(currentState, winnerId));
  }

  function handleEditList() {
    setShareUrl('');
    setCopyStatus('');
    setRawItems(state.items.map((item) => item.label).join('\n'));
    setState({
      ...state,
      phase: 'entry',
      active: null,
    });
  }

  function handleReset() {
    setRawItems('');
    setShareUrl('');
    setCopyStatus('');
    setState(createInitialState());
  }

  async function handleShare() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(SHARE_PARAM, encodeShareState(state));
    const nextShareUrl = url.toString();
    setShareUrl(nextShareUrl);

    try {
      await navigator.clipboard.writeText(nextShareUrl);
      setCopyStatus('Copied share link');
    } catch {
      setCopyStatus('Share link ready');
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Pairwise card sorting</p>
        <h1>Sort a tricky list by choosing between two cards at a time.</h1>
        <p>
          Add your options, then make simple head-to-head choices. Your progress is saved on this device, and you can
          share the current state with a link.
        </p>
      </section>

      {state.phase === 'entry' && (
        <section className="panel">
          <form onSubmit={handleStart}>
            <label htmlFor="items">Items to sort</label>
            <textarea
              id="items"
              value={rawItems}
              onChange={(event) => setRawItems(event.target.value)}
              placeholder={'One item per line\nBeach trip\nCity break\nMountain cabin'}
              rows={10}
            />
            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={normalizeItems(rawItems).length < 2}>
                Start sorting
              </button>
              {state.items.length > 0 && (
                <button type="button" className="ghost-button" onClick={handleReset}>
                  Clear saved sort
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {state.phase === 'sorting' && currentPair && (
        <section className="panel sorting-panel" aria-live="polite">
          <div className="progress-header">
            <div>
              <p className="eyebrow">Choose your preference</p>
              <h2>Which should rank higher?</h2>
            </div>
            <span>{progress}% placed</span>
          </div>
          <div className="progress-track" aria-label={`${progress}% of items placed`}>
            <div style={{ width: `${progress}%` }} />
          </div>

          <div className="card-grid">
            <button className="choice-card" onClick={() => handleChoose(currentPair[0].id)}>
              <span>Option A</span>
              {currentPair[0].label}
            </button>
            <button className="choice-card" onClick={() => handleChoose(currentPair[1].id)}>
              <span>Option B</span>
              {currentPair[1].label}
            </button>
          </div>

          <p className="sort-meta">
            {placedItems} of {totalItems} items placed; {completedComparisons} comparisons made
          </p>

          <div className="secondary-actions">
            <button type="button" className="ghost-button" onClick={handleShare}>
              Copy share link
            </button>
            <button type="button" className="ghost-button" onClick={handleEditList}>
              Edit list
            </button>
          </div>
        </section>
      )}

      {state.phase === 'done' && (
        <section className="panel">
          <div className="progress-header">
            <div>
              <p className="eyebrow">Sorted result</p>
              <h2>Your ordered list</h2>
            </div>
            <span>{completedComparisons} picks</span>
          </div>

          <ol className="result-list">
            {orderedItems.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ol>

          <div className="secondary-actions">
            <button type="button" className="primary-button" onClick={handleShare}>
              Copy share link
            </button>
            <button type="button" className="ghost-button" onClick={handleEditList}>
              Sort another list
            </button>
            <button type="button" className="ghost-button" onClick={handleReset}>
              Start over
            </button>
          </div>
        </section>
      )}

      {(shareUrl || copyStatus) && (
        <aside className="share-panel">
          {copyStatus && <strong>{copyStatus}</strong>}
          {shareUrl && <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />}
        </aside>
      )}
    </main>
  );
}

export default App;
