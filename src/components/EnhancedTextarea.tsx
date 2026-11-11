import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commonsGifSearchUrl, findEmojiQuery, insertMediaUrl, mentionReference, parseCommonsGifs, searchEmoji, type CommonsGif, type MentionQuery, type SelectedMention } from "../lib/composer";
import { uploadImage } from "../lib/blossom";
import { searchLocalIndex, type LocalPerson } from "../lib/local-search";
import { hydrateMentionEditor, insertMentionPill, mentionEditorSelectionOffsets, mentionQueryAtSelection, removeAdjacentMentionPill, replaceMentionEditorRange, selectedPlainText, serializeMentionEditor, setMentionEditorCaret } from "../lib/mention-editor";

interface EnhancedTextareaProps {
  id: string;
  value: string;
  onChange(value: string): void;
  placeholder: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  blossomServers?: string[];
  relayHints?: string[];
  mentions?: SelectedMention[];
  onMentionSelected?(mention: SelectedMention): void;
  onUploadingChange?(uploading: boolean): void;
}

export function EnhancedTextarea({ id, value, onChange, placeholder, rows = 3, maxLength = 2_800, disabled = false, blossomServers, relayHints = [], mentions, onMentionSelected, onUploadingChange }: EnhancedTextareaProps) {
  const editor = useRef<HTMLDivElement>(null);
  const selectedMentions = useRef<SelectedMention[]>(mentions ?? []);
  const savedSelection = useRef<[number, number]>([0, 0]);
  const [cursor, setCursor] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery>();
  const [panel, setPanel] = useState<"emoji" | "gif">();
  const [emojiSearch, setEmojiSearch] = useState("");
  const [gifSearch, setGifSearch] = useState("");
  const [gifs, setGifs] = useState<CommonsGif[]>([]);
  const [gifBusy, setGifBusy] = useState(false);
  const [gifMessage, setGifMessage] = useState<string>();
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string>();
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [people, setPeople] = useState<LocalPerson[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const emojiQuery = useMemo(() => findEmojiQuery(value, cursor), [value, cursor]);
  const suggestions = useMemo(() => searchEmoji(emojiQuery?.query ?? "", 8), [emojiQuery]);
  const pickerEmoji = useMemo(() => searchEmoji(emojiSearch, 72), [emojiSearch]);

  useLayoutEffect(() => {
    if (mentions) selectedMentions.current = mentions;
    const root = editor.current;
    if (!root || serializeMentionEditor(root) === value) return;
    hydrateMentionEditor(root, value, selectedMentions.current);
  }, [mentions, value]);

  useEffect(() => {
    let current = true;
    if (!mentionQuery) { setPeople([]); setPeopleBusy(false); return; }
    setSuggestionIndex(0);
    setPeopleBusy(true);
    void searchLocalIndex(mentionQuery.query).then((results) => {
      if (current) setPeople(results.people.slice(0, 8));
    }).catch(() => {
      if (current) setPeople([]);
    }).finally(() => {
      if (current) setPeopleBusy(false);
    });
    return () => { current = false; };
  }, [mentionQuery?.query, mentionQuery?.start]);

  function applyCanonical(next: { value: string; cursor: number }) {
    if (next.value.length > maxLength) return;
    const root = editor.current;
    if (!root) return;
    hydrateMentionEditor(root, next.value, selectedMentions.current);
    setMentionEditorCaret(root, next.cursor);
    savedSelection.current = [next.cursor, next.cursor];
    onChange(next.value);
    setCursor(next.cursor);
    setMentionQuery(mentionQueryAtSelection(root));
  }

  function selection(): [number, number] {
    return savedSelection.current;
  }

  function readSelection() {
    const root = editor.current;
    if (!root) return;
    const nextSelection = mentionEditorSelectionOffsets(root);
    const nextCursor = nextSelection[1];
    savedSelection.current = nextSelection;
    setCursor(nextCursor);
    setMentionQuery(mentionQueryAtSelection(root));
  }

  function emitEditorValue() {
    const root = editor.current;
    if (!root) return;
    const nextValue = serializeMentionEditor(root);
    if (nextValue.length > maxLength) {
      hydrateMentionEditor(root, value, selectedMentions.current);
      setMentionEditorCaret(root, Math.min(savedSelection.current[1], value.length));
      return;
    }
    onChange(nextValue);
    readSelection();
  }

  function chooseEmoji(emoji: string, replaceQuery = false) {
    const [start, end] = selection();
    const range = replaceQuery && emojiQuery ? [emojiQuery.start, emojiQuery.end] as const : [start, end] as const;
    const root = editor.current;
    if (!root) return;
    replaceMentionEditorRange(root, range[0], range[1], emoji);
    emitEditorValue();
    setPanel(undefined);
  }

  function choosePerson(person: LocalPerson) {
    if (!mentionQuery) return;
    const root = editor.current;
    if (!root) return;
    const mention: SelectedMention = {
      pubkey: person.pubkey,
      reference: mentionReference(person, relayHints),
      label: person.name || person.username || person.npub.slice(0, 16),
    };
    selectedMentions.current = [...selectedMentions.current.filter(({ pubkey }) => pubkey !== mention.pubkey), mention];
    insertMentionPill(root, mentionQuery, mention);
    onMentionSelected?.(mention);
    emitEditorValue();
    setPeople([]);
    setSuggestionIndex(0);
  }

  async function searchGifs(event: React.FormEvent) {
    event.preventDefault();
    const query = gifSearch.trim();
    if (query.length < 2 || gifBusy) return;
    setGifBusy(true);
    setGifMessage(undefined);
    try {
      const response = await fetch(commonsGifSearchUrl(query));
      if (!response.ok) throw new Error("GIF search is unavailable right now.");
      const results = parseCommonsGifs(await response.json());
      setGifs(results);
      if (!results.length) setGifMessage("No GIFs found. Try a different search.");
    } catch (error) {
      setGifs([]);
      setGifMessage(error instanceof Error ? error.message : "GIF search is unavailable right now.");
    } finally {
      setGifBusy(false);
    }
  }

  function chooseGif(gif: CommonsGif) {
    const [start, end] = selection();
    applyCanonical(insertMediaUrl(value, start, end, gif.url));
    setPanel(undefined);
  }

  async function pasteImages(event: React.ClipboardEvent<HTMLElement>) {
    const clipboardFiles = [...event.clipboardData.files];
    if (!clipboardFiles.length) {
      for (const item of event.clipboardData.items) {
        const file = item.kind === "file" ? item.getAsFile() : null;
        if (file) clipboardFiles.push(file);
      }
    }
    const files = clipboardFiles.filter((file) => file.type.startsWith("image/")).slice(0, 4);
    if (!files.length || pasteBusy) return;
    event.preventDefault();
    const [start, end] = savedSelection.current;
    setPasteBusy(true);
    setPasteMessage(`Uploading ${files.length} pasted image${files.length === 1 ? "" : "s"}…`);
    onUploadingChange?.(true);
    const urls: string[] = [];
    let inserted = 0;
    let failure: string | undefined;
    try {
      for (const file of files) {
        try { urls.push((await uploadImage(file, blossomServers ?? [])).url); }
        catch (error) { failure = error instanceof Error ? error.message : "A pasted image could not be uploaded."; }
      }
      if (urls.length) {
        let next = insertMediaUrl(value, start, end, urls[0]);
        for (const url of urls.slice(1)) next = insertMediaUrl(next.value, next.cursor, next.cursor, url);
        if (next.value.length > maxLength) failure = `The uploaded image URL would make this draft longer than ${maxLength.toLocaleString()} characters.`;
        else { applyCanonical(next); inserted = urls.length; }
      }
      setPasteMessage(failure
        ? `${inserted ? `${inserted} image${inserted === 1 ? "" : "s"} uploaded. ` : ""}${failure}`
        : `${inserted} pasted image${inserted === 1 ? "" : "s"} uploaded.`);
    } finally {
      setPasteBusy(false);
      onUploadingChange?.(false);
    }
  }

  return <div className="enhanced-textarea">
    <div
      ref={editor}
      id={id}
      className="mention-editor"
      contentEditable={!disabled && !pasteBusy}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      aria-placeholder={placeholder}
      aria-disabled={disabled || pasteBusy}
      aria-busy={pasteBusy}
      data-placeholder={placeholder}
      data-rows={rows}
      suppressContentEditableWarning
      onInput={emitEditorValue}
      onCopy={(event) => {
        const text = selectedPlainText(event.currentTarget);
        if (text === undefined) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", text);
      }}
      onPaste={(event) => {
        const hasFiles = event.clipboardData.files.length > 0 || [...event.clipboardData.items].some((item) => item.kind === "file");
        if (hasFiles) { void pasteImages(event); return; }
        event.preventDefault();
        const root = event.currentTarget;
        replaceMentionEditorRange(root, savedSelection.current[0], savedSelection.current[1], event.clipboardData.getData("text/plain"));
        emitEditorValue();
      }}
      onClick={readSelection}
      onKeyUp={readSelection}
      onKeyDown={(event) => {
        if ((event.key === "Backspace" || event.key === "Delete") && removeAdjacentMentionPill(event.currentTarget, event.key === "Backspace" ? "backward" : "forward")) {
          event.preventDefault();
          emitEditorValue();
          return;
        }
        const options = mentionQuery ? people : emojiQuery ? suggestions : [];
        if (!options.length) {
          if (event.key === "Escape" && mentionQuery) { event.preventDefault(); setCursor(-1); }
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSuggestionIndex((current) => (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          if (mentionQuery) choosePerson(people[Math.min(suggestionIndex, people.length - 1)]);
          else chooseEmoji(suggestions[Math.min(suggestionIndex, suggestions.length - 1)].emoji, true);
          setSuggestionIndex(0);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setCursor(-1);
        }
      }}
    />
    {mentionQuery && <div className="mention-autocomplete" role="listbox" aria-label="People suggestions" aria-busy={peopleBusy}>
      {people.map((person, index) => <button key={person.pubkey} type="button" role="option" aria-selected={index === suggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => choosePerson(person)}><span className="mention-person"><strong>{person.name || person.username || "Nostr user"}</strong>{person.username && person.username !== person.name && <small>@{person.username}</small>}</span><code>{person.npub.slice(0, 16)}…</code></button>)}
      {peopleBusy && !people.length && <span className="mention-loading" role="status">Searching people…</span>}
      {!peopleBusy && !people.length && <span className="mention-loading" role="status">No cached people match.</span>}
    </div>}
    {!mentionQuery && emojiQuery && suggestions.length > 0 && <div className="emoji-autocomplete" role="listbox" aria-label="Emoji suggestions">
      {suggestions.map((entry, index) => <button key={entry.shortcode} type="button" role="option" aria-selected={index === suggestionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseEmoji(entry.emoji, true)}><span>{entry.emoji}</span>:{entry.shortcode}:</button>)}
    </div>}
    <div className="expression-tools" aria-label="Add to your message">
      <button type="button" disabled={disabled || pasteBusy} aria-expanded={panel === "emoji"} aria-controls={`${id}-emoji-panel`} onClick={() => setPanel((current) => current === "emoji" ? undefined : "emoji")}><span aria-hidden="true">☺</span> Emoji</button>
      <button type="button" disabled={disabled || pasteBusy} aria-expanded={panel === "gif"} aria-controls={`${id}-gif-panel`} onClick={() => setPanel((current) => current === "gif" ? undefined : "gif")}><span className="gif-badge" aria-hidden="true">GIF</span> GIF</button>
    </div>
    {pasteMessage && <p className="paste-upload-message" role="status">{pasteMessage}</p>}
    {panel === "emoji" && <section className="expression-panel emoji-panel" id={`${id}-emoji-panel`} aria-label="Emoji library">
      <input type="search" value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} placeholder="Search emoji" aria-label="Search emoji" autoFocus />
      <div className="emoji-grid">{pickerEmoji.map((entry) => <button key={entry.shortcode} type="button" title={`:${entry.shortcode}:`} aria-label={entry.shortcode.replaceAll("_", " ")} onClick={() => chooseEmoji(entry.emoji)}>{entry.emoji}</button>)}</div>
      {!pickerEmoji.length && <p>No matching emoji.</p>}
    </section>}
    {panel === "gif" && <section className="expression-panel gif-panel" id={`${id}-gif-panel`} aria-label="GIF library">
      <form className="gif-search" onSubmit={searchGifs}><input type="search" value={gifSearch} minLength={2} onChange={(event) => setGifSearch(event.target.value)} placeholder="Search GIFs" aria-label="Search GIFs" autoFocus /><button type="submit" disabled={gifBusy || gifSearch.trim().length < 2}>{gifBusy ? "Searching…" : "Search"}</button></form>
      {gifMessage && <p role="status">{gifMessage}</p>}
      <div className="gif-grid">{gifs.map((gif) => <article key={gif.url} data-testid="gif-preview"><button type="button" onClick={() => chooseGif(gif)} aria-label={`Add ${gif.title}`}><img src={gif.url} alt="" loading="lazy" /></button><a href={gif.sourceUrl} target="_blank" rel="noopener noreferrer" title={gif.title}>View source</a></article>)}</div>
      <small>GIFs from Wikimedia Commons. Check the source page for its licence.</small>
    </section>}
  </div>;
}
