import { FormEvent, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'card-sort-state-v1';
const HISTORY_KEY = 'card-sort-history-v1';
const SHARE_PARAM = 'state';
const MAX_HISTORY_ENTRIES = 50;
const canUseRandomUuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto;

type AppPhase = 'entry' | 'sorting' | 'done';

type Comparison = {
  candidateId: string;
  pivotId: string;
  winnerId: string;
};

type SortState = {
  version: 1;
  sessionId: string;
  title: string;
  items: SortItem[];
  sortedIds: string[];
  pendingIds: string[];
  active: ActiveInsertion | null;
  comparisons: Comparison[];
  phase: AppPhase;
  historyRecorded: boolean;
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

type HistoryEntry = {
  id: string;
  title: string;
  completedAt: string;
  items: string[];
  orderedItems: string[];
  comparisons: number;
};

type ShareState = Pick<SortState, 'title' | 'items' | 'sortedIds' | 'pendingIds' | 'active' | 'comparisons' | 'phase'>;

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${canUseRandomUuid ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

function createInitialState(): SortState {
  return {
    version: 1,
    sessionId: createId('sort'),
    title: '',
    items: [],
    sortedIds: [],
    pendingIds: [],
    active: null,
    comparisons: [],
    phase: 'entry',
    historyRecorded: false,
  };
}

function createItem(label: string, index: number): SortItem {
  return {
    id: `${createId('item')}-${index}`,
    label,
  };
}

function parseItemLabels(input: string): string[] {
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
}

function normalizeItems(input: string): SortItem[] {
  return parseItemLabels(input)
    .map(createItem);
}

function startSorting(items: SortItem[], title = ''): SortState {
  const initialState = createInitialState();
  const trimmedTitle = title.trim();

  if (items.length === 0) {
    return {
      ...initialState,
      title: trimmedTitle,
    };
  }

  if (items.length === 1) {
    return {
      ...initialState,
      title: trimmedTitle,
      items,
      sortedIds: [items[0].id],
      phase: 'done',
    };
  }

  return {
    ...initialState,
    title: trimmedTitle,
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

function sanitizeComparisons(value: unknown, itemIds: Set<string>): Comparison[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (comparison): comparison is Comparison =>
      Boolean(comparison) &&
      typeof comparison === 'object' &&
      typeof (comparison as Comparison).candidateId === 'string' &&
      typeof (comparison as Comparison).pivotId === 'string' &&
      typeof (comparison as Comparison).winnerId === 'string' &&
      itemIds.has((comparison as Comparison).candidateId) &&
      itemIds.has((comparison as Comparison).pivotId) &&
      itemIds.has((comparison as Comparison).winnerId),
  );
}

function sanitizeState(value: unknown, suppressCompletedHistory = false): SortState | null {
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
      ? {
          itemId: candidate.active.itemId,
          low: Math.max(0, Math.min(candidate.active.low, sortedIds.length)),
          high: Math.max(0, Math.min(candidate.active.high, sortedIds.length)),
        }
      : null;
  const phase: AppPhase =
    candidate.phase === 'sorting' || candidate.phase === 'done' || candidate.phase === 'entry'
      ? candidate.phase
      : items.length > 0
        ? 'sorting'
        : 'entry';

  return ensureActiveInsertion({
    version: 1,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : createId('sort'),
    title: typeof candidate.title === 'string' ? candidate.title : '',
    items,
    sortedIds,
    pendingIds,
    active,
    comparisons: sanitizeComparisons(candidate.comparisons, itemIds),
    phase,
    historyRecorded: Boolean(candidate.historyRecorded) || (suppressCompletedHistory && phase === 'done'),
  });
}

function encodeShareState(state: SortState): string {
  const shareState: ShareState = {
    title: state.title,
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
    return sanitizeState(JSON.parse(json), true);
  } catch {
    return null;
  }
}

function loadInitialSnapshot(): { state: SortState; rawItems: string } {
  const params = new URLSearchParams(window.location.search);
  const sharedState = params.get(SHARE_PARAM);

  if (sharedState) {
    const decoded = decodeShareState(sharedState);
    if (decoded) {
      return {
        state: decoded,
        rawItems: decoded.items.map((item) => item.label).join('\n'),
      };
    }
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const state = stored ? sanitizeState(JSON.parse(stored)) ?? createInitialState() : createInitialState();
    return {
      state,
      rawItems: state.items.map((item) => item.label).join('\n'),
    };
  } catch {
    const state = createInitialState();
    return { state, rawItems: '' };
  }
}

function sanitizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is HistoryEntry =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as HistoryEntry).id === 'string' &&
        typeof (entry as HistoryEntry).completedAt === 'string' &&
        Array.isArray((entry as HistoryEntry).items) &&
        Array.isArray((entry as HistoryEntry).orderedItems) &&
        typeof (entry as HistoryEntry).comparisons === 'number',
    )
    .slice(0, MAX_HISTORY_ENTRIES);
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? sanitizeHistory(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function createHistoryEntry(state: SortState): HistoryEntry {
  return {
    id: state.sessionId,
    title: state.title,
    completedAt: new Date().toISOString(),
    items: state.items.map((item) => item.label),
    orderedItems: getOrderedItems(state).map((item) => item.label),
    comparisons: state.comparisons.length,
  };
}

function formatCompletedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function App() {
  const [initialSnapshot] = useState(loadInitialSnapshot);
  const [state, setState] = useState<SortState>(() => initialSnapshot.state);
  const [rawItems, setRawItems] = useState(() => initialSnapshot.rawItems);
  const [listTitle, setListTitle] = useState(() => initialSnapshot.state.title);
  const [newItems, setNewItems] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [shareUrl, setShareUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const currentPair = getCurrentPair(state);
  const orderedItems = useMemo(() => getOrderedItems(state), [state]);
  const totalItems = state.items.length;
  const placedItems = state.sortedIds.length;
  const completedComparisons = state.comparisons.length;
  const progress = totalItems <= 1 ? 100 : Math.min(100, Math.round((placedItems / totalItems) * 100));
  const uniqueItemCount = normalizeItems(rawItems).length;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  function saveCompletedSort(nextState: SortState): SortState {
    if (nextState.phase !== 'done' || nextState.historyRecorded) {
      return nextState;
    }

    const entry = createHistoryEntry(nextState);
    setHistory((currentHistory) => {
      const withoutDuplicate = currentHistory.filter((historyEntry) => historyEntry.id !== entry.id);
      return [entry, ...withoutDuplicate].slice(0, MAX_HISTORY_ENTRIES);
    });

    return {
      ...nextState,
      historyRecorded: true,
    };
  }

  function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = normalizeItems(rawItems);
    setShareUrl('');
    setCopyStatus('');
    setState(saveCompletedSort(ensureActiveInsertion(startSorting(items, listTitle))));
  }

  function handleResort(labels: string[], title = '') {
    const nextRawItems = labels.join('\n');
    const items = normalizeItems(nextRawItems);
    setRawItems(nextRawItems);
    setListTitle(title);
    setNewItems('');
    setShareUrl('');
    setCopyStatus('');
    setState(saveCompletedSort(ensureActiveInsertion(startSorting(items, title))));
  }

  function handleChoose(winnerId: string) {
    setShareUrl('');
    setCopyStatus('');
    setState((currentState) => saveCompletedSort(recordChoice(currentState, winnerId)));
  }

  function handleEditList() {
    setShareUrl('');
    setCopyStatus('');
    setRawItems(state.items.map((item) => item.label).join('\n'));
    setListTitle(state.title);
    setNewItems('');
    setState({
      ...state,
      phase: 'entry',
      active: null,
    });
  }

  function handleReset() {
    setRawItems('');
    setListTitle('');
    setNewItems('');
    setShareUrl('');
    setCopyStatus('');
    setState(createInitialState());
  }

  function handleTitleChange(value: string) {
    setListTitle(value);
    setShareUrl('');
    setCopyStatus('');
    if (state.phase === 'done') {
      setHistory((currentHistory) =>
        currentHistory.map((entry) => (entry.id === state.sessionId ? { ...entry, title: value } : entry)),
      );
    }
    setState((currentState) => ({
      ...currentState,
      title: value,
    }));
  }

  function handleAddItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const labelsToAdd = parseItemLabels(newItems);

    if (labelsToAdd.length === 0) {
      return;
    }

    setShareUrl('');
    setCopyStatus('');
    setState((currentState) => {
      const existingLabels = new Set(currentState.items.map((item) => item.label.toLocaleLowerCase()));
      const additions = labelsToAdd
        .filter((label) => !existingLabels.has(label.toLocaleLowerCase()))
        .map((label, index) => createItem(label, currentState.items.length + index));

      if (additions.length === 0) {
        return currentState;
      }

      setRawItems([...currentState.items.map((item) => item.label), ...additions.map((item) => item.label)].join('\n'));
      setNewItems('');

      const nextState: SortState = {
        ...currentState,
        sessionId: currentState.phase === 'done' ? createId('sort') : currentState.sessionId,
        items: [...currentState.items, ...additions],
        pendingIds: [...currentState.pendingIds, ...additions.map((item) => item.id)],
        phase: currentState.phase === 'done' ? 'sorting' : currentState.phase,
        historyRecorded: false,
      };

      return ensureActiveInsertion(nextState);
    });
  }

  function handleClearHistory() {
    setHistory([]);
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
      <header className="app-header">
        <div>
          <p className="eyebrow">Pairwise sorter</p>
          <h1>Card Sort</h1>
        </div>
        <p>Rank a list through quick head-to-head choices. Progress stays local unless you copy a share link.</p>
      </header>

      {state.phase === 'entry' && (
        <section className="panel">
          <form onSubmit={handleStart}>
            <div className="field-stack">
              <label htmlFor="list-title">List title or question</label>
              <input
                id="list-title"
                className="title-input"
                value={listTitle}
                onChange={(event) => handleTitleChange(event.target.value)}
                placeholder="Best trip ideas, next project, dinner options..."
              />
            </div>
            <div>
              <label htmlFor="items">Items to sort</label>
              <p className="field-hint">Enter one item per line. Duplicates are removed before sorting.</p>
            </div>
            <textarea
              id="items"
              value={rawItems}
              onChange={(event) => setRawItems(event.target.value)}
              placeholder={'One item per line\nBeach trip\nCity break\nMountain cabin'}
              rows={10}
            />
            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={uniqueItemCount < 2}>
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

      {state.phase !== 'entry' && (
        <section className="panel utility-panel">
          <div>
            <p className="eyebrow">Current list</p>
            <h2>List details</h2>
            <p>Name the category you are sorting or the question this list answers.</p>
          </div>
          <div className="field-stack">
            <label htmlFor="active-list-title">List title or question</label>
            <input
              id="active-list-title"
              className="title-input"
              value={listTitle}
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="Best trip ideas, next project, dinner options..."
            />
          </div>
        </section>
      )}

      {state.phase === 'sorting' && currentPair && (
        <section className="panel sorting-panel" aria-live="polite">
          <div className="progress-header">
            <div>
              <p className="eyebrow">Choose your preference</p>
              <h2>{state.title || 'Which should rank higher?'}</h2>
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

          <form className="add-items-form" onSubmit={handleAddItems}>
            <div>
              <label htmlFor="new-items">Add items to this sort</label>
              <p className="field-hint">New items will be compared after the current choice path.</p>
            </div>
            <textarea
              id="new-items"
              value={newItems}
              onChange={(event) => setNewItems(event.target.value)}
              placeholder={'One new item per line'}
              rows={3}
            />
            <button type="submit" className="ghost-button" disabled={parseItemLabels(newItems).length === 0}>
              Add to sort
            </button>
          </form>

          <div className="secondary-actions">
            <button type="button" className="ghost-button" onClick={handleShare}>
              Copy share link
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => handleResort(state.items.map((item) => item.label), state.title)}
            >
              Re-sort this list
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
              <h2>{state.title || 'Your ordered list'}</h2>
            </div>
            <span>{completedComparisons} picks</span>
          </div>

          <ol className="result-list">
            {orderedItems.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ol>

          <form className="add-items-form" onSubmit={handleAddItems}>
            <div>
              <label htmlFor="new-items-done">Add items and keep sorting</label>
              <p className="field-hint">Added items will be inserted into this completed order with new comparisons.</p>
            </div>
            <textarea
              id="new-items-done"
              value={newItems}
              onChange={(event) => setNewItems(event.target.value)}
              placeholder={'One new item per line'}
              rows={3}
            />
            <button type="submit" className="ghost-button" disabled={parseItemLabels(newItems).length === 0}>
              Add and compare
            </button>
          </form>

          <div className="secondary-actions">
            <button type="button" className="primary-button" onClick={handleShare}>
              Copy share link
            </button>
            <button type="button" className="ghost-button" onClick={handleEditList}>
              Sort another list
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => handleResort(state.items.map((item) => item.label), state.title)}
            >
              Re-sort this list
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

      <section className="panel history-panel">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Local history</p>
            <h2>Past sorted lists</h2>
          </div>
          {history.length > 0 && (
            <button type="button" className="ghost-button compact-button" onClick={handleClearHistory}>
              Clear
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="empty-history">Completed sorts will appear here on this device.</p>
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-card" key={entry.id}>
                <div className="history-card-header">
                  <div>
                    <h3>{entry.title || 'Untitled list'}</h3>
                    <p>
                      {formatCompletedAt(entry.completedAt)}; {entry.items.length} items; {entry.comparisons} comparisons
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => handleResort(entry.items, entry.title)}
                  >
                    Re-sort
                  </button>
                </div>
                <ol>
                  {entry.orderedItems.map((item, index) => (
                    <li key={`${entry.id}-${item}-${index}`}>{item}</li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
