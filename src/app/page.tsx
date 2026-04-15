"use client";

import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";

type BlockType = "title" | "heading" | "subheading" | "paragraph" | "pause";

type ContentBlock = {
  id: string;
  type: BlockType;
  text: string;
  seconds?: number;
};

type VoiceOption = SpeechSynthesisVoice;

const SAMPLE_HTML = `<h1>Photosynthesis</h1>
<h2>Definition</h2>
<p>Photosynthesis is the process by which green plants use sunlight, water, and carbon dioxide to produce food.</p>
<p>It also releases oxygen as a by-product.</p>
[[pause:3]]
<h2>Why it matters</h2>
<p>Photosynthesis is important because it supports most life on Earth.</p>`;

const SPEED_OPTIONS = [20, 30, 40, 50, 60, 70, 80, 90, 100];
const PAUSE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const BASE_WPM = 150;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sanitizeIncoming(input: string) {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "p", "br", "strong", "em"],
    ALLOWED_ATTR: [],
  });
}

function isProbablyHtml(input: string) {
  return /<\/?[a-z][\s\S]*>/i.test(input);
}

function blocksFromPlainText(raw: string): ContentBlock[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: ContentBlock[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    const joined = paragraphBuffer.join(" ").trim();
    if (joined) {
      blocks.push({
        id: uid(),
        type: "paragraph",
        text: joined,
      });
    }
    paragraphBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const pauseMatch = trimmed.match(/^\[\[pause:(\d{1,2})\]\]$/i);
    if (pauseMatch) {
      flushParagraph();
      const seconds = Math.min(10, Math.max(1, Number(pauseMatch[1])));
      blocks.push({
        id: uid(),
        type: "pause",
        text: "",
        seconds,
      });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const wordCount = countWords(trimmed);
    const looksLikeHeading =
      wordCount <= 10 &&
      !/[.!?]$/.test(trimmed) &&
      trimmed.length < 80;

    if (looksLikeHeading) {
      flushParagraph();
      blocks.push({
        id: uid(),
        type: blocks.length === 0 ? "title" : "heading",
        text: trimmed,
      });
    } else {
      paragraphBuffer.push(trimmed);
    }
  }

  flushParagraph();
  return blocks;
}

function blocksFromHtml(rawHtml: string): ContentBlock[] {
  const sanitized = sanitizeIncoming(rawHtml);
  const normalized = sanitized.replace(
    /\[\[pause:(\d{1,2})\]\]/gi,
    (_, seconds) => `<p data-pause="${seconds}"></p>`
  );

  const parser = new DOMParser();
  const doc = parser.parseFromString(normalized, "text/html");
  const body = doc.body;
  const blocks: ContentBlock[] = [];

  const children = Array.from(body.childNodes);

  children.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? "";
      if (text) {
        blocks.push(...blocksFromPlainText(text));
      }
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    const pause = node.getAttribute("data-pause");
    if (pause) {
      blocks.push({
        id: uid(),
        type: "pause",
        text: "",
        seconds: Math.min(10, Math.max(1, Number(pause))),
      });
      return;
    }

    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) return;

    const tag = node.tagName.toLowerCase();

    if (tag === "h1") {
      blocks.push({ id: uid(), type: "title", text });
    } else if (tag === "h2") {
      blocks.push({ id: uid(), type: "heading", text });
    } else if (tag === "h3") {
      blocks.push({ id: uid(), type: "subheading", text });
    } else if (tag === "p") {
      blocks.push({ id: uid(), type: "paragraph", text });
    } else {
      blocks.push({ id: uid(), type: "paragraph", text });
    }
  });

  return blocks;
}

function parseInputToBlocks(raw: string) {
  if (!raw.trim()) return [];
  return isProbablyHtml(raw) ? blocksFromHtml(raw) : blocksFromPlainText(raw);
}

function blockAnnouncement(
  block: ContentBlock,
  options: {
    announceHeadings: boolean;
    announceParagraphs: boolean;
  }
) {
  if (block.type === "pause") return "";

  const parts: string[] = [];

  if (
    options.announceHeadings &&
    (block.type === "title" ||
      block.type === "heading" ||
      block.type === "subheading")
  ) {
    parts.push(block.type === "title" ? "Title." : "Heading.");
  }

  if (options.announceParagraphs && block.type === "paragraph") {
    parts.push("New paragraph.");
  }

  parts.push(block.text);

  return parts.join(" ");
}

function estimateBlockSeconds(
  block: ContentBlock,
  speedPercent: number,
  options: {
    announceHeadings: boolean;
    announceParagraphs: boolean;
    announceEnd: boolean;
  }
) {
  if (block.type === "pause") return block.seconds ?? 1;

  const text = blockAnnouncement(block, {
    announceHeadings: options.announceHeadings,
    announceParagraphs: options.announceParagraphs,
  });

  const words = Math.max(1, countWords(text));
  const relativeRate = Math.max(0.2, speedPercent / 100);
  const wpm = BASE_WPM * relativeRate;

  return (words / wpm) * 60;
}

export default function Page() {
  const [rawInput, setRawInput] = useState(SAMPLE_HTML);
  const [blocks, setBlocks] = useState<ContentBlock[]>(() =>
    parseInputToBlocks(SAMPLE_HTML)
  );
  const [speedPercent, setSpeedPercent] = useState(70);
  const [defaultPauseSeconds, setDefaultPauseSeconds] = useState(3);
  const [announceHeadings, setAnnounceHeadings] = useState(true);
  const [announceParagraphs, setAnnounceParagraphs] = useState(true);
  const [announceEnd, setAnnounceEnd] = useState(true);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<
    "idle" | "playing" | "paused" | "stopped"
  >("idle");
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const currentIndexRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("This browser does not support speech synthesis.");
      return;
    }

    const loadVoices = () => {
      const nextVoices = window.speechSynthesis.getVoices();
      setVoices(nextVoices);
      if (!selectedVoice && nextVoices.length > 0) {
        const preferred =
          nextVoices.find((v) => v.lang.startsWith("en-IE")) ||
          nextVoices.find((v) => v.lang.startsWith("en-GB")) ||
          nextVoices.find((v) => v.lang.startsWith("en")) ||
          nextVoices[0];

        if (preferred) {
          setSelectedVoice(preferred.name);
        }
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.cancel();
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [selectedVoice]);

  const totalEstimatedSeconds = useMemo(() => {
    let total = blocks.reduce((sum, block) => {
      return (
        sum +
        estimateBlockSeconds(block, speedPercent, {
          announceHeadings,
          announceParagraphs,
          announceEnd,
        })
      );
    }, 0);

    if (announceEnd) {
      total += estimateBlockSeconds(
        {
          id: "end",
          type: "paragraph",
          text: "End of text",
        },
        speedPercent,
        {
          announceHeadings: false,
          announceParagraphs: false,
          announceEnd: false,
        }
      );
    }

    return total;
  }, [blocks, speedPercent, announceHeadings, announceParagraphs, announceEnd]);

  const wordCountTotal = useMemo(() => {
    return blocks.reduce((sum, block) => sum + countWords(block.text), 0);
  }, [blocks]);

  const progressPercent = useMemo(() => {
    if (totalEstimatedSeconds <= 0) return 0;
    return Math.min(100, (elapsedSeconds / totalEstimatedSeconds) * 100);
  }, [elapsedSeconds, totalEstimatedSeconds]);

  const currentBlockLabel = useMemo(() => {
    if (activeBlockIndex == null || !blocks[activeBlockIndex]) {
      return "Nothing is currently playing.";
    }

    const block = blocks[activeBlockIndex];
    if (block.type === "pause") {
      return `Silent pause (${block.seconds ?? 1}s)`;
    }

    return `${block.type}: ${block.text.slice(0, 120)}${
      block.text.length > 120 ? "..." : ""
    }`;
  }, [activeBlockIndex, blocks]);

  const startTicking = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);

    tickRef.current = window.setInterval(() => {
      if (sessionStartRef.current == null) return;
      const delta = (Date.now() - sessionStartRef.current) / 1000;
      setElapsedSeconds(pausedElapsedRef.current + delta);
    }, 250);
  };

  const stopTicking = () => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const hardStop = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    stopTicking();
    currentIndexRef.current = 0;
    sessionStartRef.current = null;
    pausedElapsedRef.current = 0;
    setElapsedSeconds(0);
    setActiveBlockIndex(null);
    setStatus("stopped");
  };

  const speakEndMessage = () => {
    if (!announceEnd) {
      setStatus("stopped");
      stopTicking();
      return;
    }

    const utterance = new SpeechSynthesisUtterance("End of text");
    utterance.rate = speedPercent / 100;

    const voice = voices.find((v) => v.name === selectedVoice);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      stopTicking();
      setStatus("stopped");
      setActiveBlockIndex(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  const speakFromIndex = (index: number) => {
    if (index >= blocks.length) {
      speakEndMessage();
      return;
    }

    const block = blocks[index];
    currentIndexRef.current = index;
    setActiveBlockIndex(index);

    if (block.type === "pause") {
      timeoutRef.current = window.setTimeout(() => {
        speakFromIndex(index + 1);
      }, (block.seconds ?? defaultPauseSeconds) * 1000);
      return;
    }

    const message = blockAnnouncement(block, {
      announceHeadings,
      announceParagraphs,
    });

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = speedPercent / 100;

    const voice = voices.find((v) => v.name === selectedVoice);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      speakFromIndex(index + 1);
    };

    utterance.onerror = () => {
      setError("Speech synthesis failed during playback.");
      hardStop();
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleParse = () => {
    try {
      setError("");
      const parsed = parseInputToBlocks(rawInput);
      setBlocks(parsed);
      hardStop();
    } catch {
      setError("Failed to parse the pasted content.");
    }
  };

  const handlePlay = () => {
    if (blocks.length === 0) {
      setError("Parse some content first.");
      return;
    }

    setError("");
    window.speechSynthesis.cancel();

    currentIndexRef.current = 0;
    pausedElapsedRef.current = 0;
    setElapsedSeconds(0);
    sessionStartRef.current = Date.now();
    setStatus("playing");
    startTicking();
    speakFromIndex(0);
  };

  const handlePause = () => {
    if (status !== "playing") return;

    window.speechSynthesis.pause();
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (sessionStartRef.current != null) {
      pausedElapsedRef.current += (Date.now() - sessionStartRef.current) / 1000;
      sessionStartRef.current = null;
      setElapsedSeconds(pausedElapsedRef.current);
    }

    stopTicking();
    setStatus("paused");
  };

  const handleResume = () => {
    if (status !== "paused") return;

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      sessionStartRef.current = Date.now();
      startTicking();
      setStatus("playing");
      return;
    }

    sessionStartRef.current = Date.now();
    setStatus("playing");
    startTicking();
    speakFromIndex(currentIndexRef.current);
  };

  const handleStop = () => {
    hardStop();
  };

  const jumpToIndex = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= blocks.length) return;
    window.speechSynthesis.cancel();
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    currentIndexRef.current = newIndex;
    pausedElapsedRef.current = blocks
      .slice(0, newIndex)
      .reduce(
        (sum, block) =>
          sum +
          estimateBlockSeconds(block, speedPercent, {
            announceHeadings,
            announceParagraphs,
            announceEnd,
          }),
        0
      );

    setElapsedSeconds(pausedElapsedRef.current);
    sessionStartRef.current = Date.now();
    setStatus("playing");
    startTicking();
    speakFromIndex(newIndex);
  };

  const updateBlock = (
    id: string,
    changes: Partial<ContentBlock>
  ) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, ...changes } : block))
    );
  };

  const deleteBlock = (id: string) => {
    setBlocks((prev) => prev.filter((block) => block.id !== id));
  };

  const addBlock = () => {
    setBlocks((prev) => [
      ...prev,
      { id: uid(), type: "paragraph", text: "New paragraph text." },
    ]);
  };

  return (
    <main className="page">
      <header className="header">
        <h1>Dictation Reader</h1>
        <p>
          Paste plain text or simple semantic HTML, review the structure, then
          play it back slowly with time-based progress. Built for dictation,
          handwriting practice, and accessible reading without the usual
          nonsense.
        </p>
      </header>

      <div className="grid">
        <section className="leftColumn">
          <div className="card">
            <h2>Paste content</h2>
            <p className="helper">
              Supports plain text or simple HTML such as h1, h2, h3, and p.
              Manual pauses can be added as <strong>[[pause:3]]</strong>.
            </p>

            <textarea
              className="bigInput"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Paste plain text or semantic HTML here..."
            />

            <div className="controlsRow">
              <button className="primary" onClick={handleParse}>
                Parse content
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setRawInput(SAMPLE_HTML);
                  setError("");
                }}
              >
                Load demo content
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setRawInput("");
                  setBlocks([]);
                  hardStop();
                }}
              >
                Clear
              </button>
            </div>

            <div className="codeSample">
{`Example HTML:
<h1>Main Title</h1>
<h2>Section Heading</h2>
<p>First paragraph.</p>
[[pause:3]]
<p>Second paragraph.</p>`}
            </div>

            {error ? <div className="error">{error}</div> : null}
          </div>

          <div className="card">
            <h2>Parsed structure</h2>
            <p className="helper">
              Review and fix the structure before playback. This is the app’s
              source of truth, not whatever random clipboard mood showed up.
            </p>

            <div className="blockList">
              {blocks.length === 0 ? (
                <div className="smallNote">
                  No blocks yet. Paste content and click Parse content.
                </div>
              ) : (
                blocks.map((block, index) => (
                  <div
                    key={block.id}
                    className={`blockCard ${
                      activeBlockIndex === index ? "active" : ""
                    }`}
                  >
                    <div className="blockHeader">
                      <select
                        value={block.type}
                        onChange={(e) =>
                          updateBlock(block.id, {
                            type: e.target.value as BlockType,
                          })
                        }
                      >
                        <option value="title">Title</option>
                        <option value="heading">Heading</option>
                        <option value="subheading">Subheading</option>
                        <option value="paragraph">Paragraph</option>
                        <option value="pause">Pause</option>
                      </select>

                      {block.type === "pause" ? (
                        <select
                          value={block.seconds ?? defaultPauseSeconds}
                          onChange={(e) =>
                            updateBlock(block.id, {
                              seconds: Number(e.target.value),
                            })
                          }
                        >
                          {PAUSE_OPTIONS.map((seconds) => (
                            <option key={seconds} value={seconds}>
                              {seconds} second{seconds > 1 ? "s" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <textarea
                          value={block.text}
                          onChange={(e) =>
                            updateBlock(block.id, { text: e.target.value })
                          }
                        />
                      )}

                      <button
                        className="danger"
                        onClick={() => deleteBlock(block.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="footerActions">
              <button className="secondary" onClick={addBlock}>
                Add block
              </button>
            </div>
          </div>
        </section>

        <aside className="rightColumn">
          <div className="card">
            <h2>Playback settings</h2>

            <div className="formGrid">
              <div className="field">
                <label htmlFor="voice">Voice</label>
                <select
                  id="voice"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {voices.map((voice) => (
                    <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="speed">Speed</label>
                <select
                  id="speed"
                  value={speedPercent}
                  onChange={(e) => setSpeedPercent(Number(e.target.value))}
                >
                  {SPEED_OPTIONS.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}%
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="defaultPause">Default pause</label>
                <select
                  id="defaultPause"
                  value={defaultPauseSeconds}
                  onChange={(e) => setDefaultPauseSeconds(Number(e.target.value))}
                >
                  {PAUSE_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} second{seconds > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Status</label>
                <input value={status} readOnly />
              </div>
            </div>

            <div className="toggleRow">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={announceHeadings}
                  onChange={(e) => setAnnounceHeadings(e.target.checked)}
                />
                Announce headings
              </label>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={announceParagraphs}
                  onChange={(e) => setAnnounceParagraphs(e.target.checked)}
                />
                Announce paragraphs
              </label>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={announceEnd}
                  onChange={(e) => setAnnounceEnd(e.target.checked)}
                />
                Announce end of text
              </label>
            </div>

            <div className="controlsRow">
              <button className="primary" onClick={handlePlay}>
                Play
              </button>
              <button className="secondary" onClick={handlePause}>
                Pause
              </button>
              <button className="secondary" onClick={handleResume}>
                Resume
              </button>
              <button className="ghost" onClick={handleStop}>
                Stop
              </button>
            </div>

            <div className="controlsRow">
              <button
                className="ghost"
                onClick={() =>
                  jumpToIndex(Math.max(0, (activeBlockIndex ?? 0) - 1))
                }
              >
                Previous
              </button>
              <button
                className="ghost"
                onClick={() => jumpToIndex(activeBlockIndex ?? 0)}
              >
                Repeat current
              </button>
              <button
                className="ghost"
                onClick={() =>
                  jumpToIndex(
                    Math.min(blocks.length - 1, (activeBlockIndex ?? -1) + 1)
                  )
                }
              >
                Next
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Progress</h2>

            <div className="stats">
              <div className="stat">
                <span className="statLabel">Words</span>
                <span className="statValue">{wordCountTotal}</span>
              </div>
              <div className="stat">
                <span className="statLabel">Total</span>
                <span className="statValue">
                  {formatTime(totalEstimatedSeconds)}
                </span>
              </div>
              <div className="stat">
                <span className="statLabel">Elapsed</span>
                <span className="statValue">{formatTime(elapsedSeconds)}</span>
              </div>
              <div className="stat">
                <span className="statLabel">Remaining</span>
                <span className="statValue">
                  {formatTime(totalEstimatedSeconds - elapsedSeconds)}
                </span>
              </div>
            </div>

            <div className="progressWrap">
              <div className="progressBar" aria-label="Playback progress">
                <div
                  className="progressFill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="currentBlock">
              <strong>Current block:</strong> {currentBlockLabel}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}