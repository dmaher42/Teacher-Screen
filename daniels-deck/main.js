(() => {
  const { useEffect, useMemo, useState, useRef } = React;
  const STORAGE_KEYS = {
    lessons: "daniels-deck-lessons",
    currentLesson: "daniels-deck-current-lesson",
    pollResults: "daniels-deck-poll-results",
    reflections: "daniels-deck-reflections",
    classList: "daniels-deck-class-list",
    theme: "daniels-deck-theme",
    logo: "daniels-deck-logo"
  };
  const defaultSlides = [
    { id: "s1", type: "title", title: "Year 7 Civics", subtitle: "Rights, Responsibilities, and Community" },
    { id: "s2", type: "list", title: "Learning Goals", bullets: ["Explain civic responsibility", "Identify active citizenship examples", "Connect civics to school life"] },
    { id: "s3", type: "timer", title: "Think-Pair-Share", duration: 120 },
    { id: "s4", type: "poll", title: "Which civic action has strongest impact?", options: ["Voting", "Volunteering", "Petitioning", "Community meetings"] },
    { id: "s5", type: "reflection", title: "Reflection Prompt", prompt: "What is one action you can take this week to improve your community?" },
    { id: "s6", type: "randomName", title: "Random Speaker", prompt: "Who would like to share first?" },
    {
      id: "s7",
      type: "stack",
      title: "Coaching Drill Walkthrough",
      steps: [
        { id: "s7-1", type: "title", title: "Drill Step 1", subtitle: "Set up cones and assign pairs" },
        { id: "s7-2", type: "list", title: "Drill Step 2", bullets: ["30 second sprint", "20 second recover", "Repeat for 6 rounds"] },
        { id: "s7-3", type: "reflection", title: "Drill Debrief", prompt: "What made this drill challenging today?" }
      ]
    }
  ];
  const defaultLesson = {
    id: "lesson-default",
    title: "Daniel's Deck Starter Session",
    date: (/* @__PURE__ */ new Date()).toISOString(),
    slides: defaultSlides
  };
  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.error(`Failed to read ${key} from localStorage`, error);
      return fallback;
    }
  }
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to write ${key} to localStorage`, error);
    }
  }
  function TitleSlide({ slide, logo }) {
    return /* @__PURE__ */ React.createElement("div", { className: "h-full flex flex-col items-center justify-center text-center gap-4" }, logo ? /* @__PURE__ */ React.createElement("img", { src: logo, alt: "School logo", className: "h-20 object-contain" }) : null, /* @__PURE__ */ React.createElement("h1", { className: "text-4xl font-bold" }, slide.title), /* @__PURE__ */ React.createElement("p", { className: "text-xl text-slate-500" }, slide.subtitle));
  }
  function ListSlide({ slide, revealCount, onRevealNext }) {
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold mb-6" }, slide.title), /* @__PURE__ */ React.createElement("ul", { className: "space-y-3 list-disc pl-8 text-xl" }, slide.bullets.map((bullet, index) => /* @__PURE__ */ React.createElement("li", { key: bullet, className: index < revealCount ? "opacity-100" : "opacity-20" }, bullet))), /* @__PURE__ */ React.createElement("button", { onClick: onRevealNext, className: "mt-8 px-4 py-2 rounded bg-indigo-600 text-white" }, "Reveal next point"));
  }
  function TimerSlide({ slide }) {
    const [remaining, setRemaining] = useState(slide.duration || 60);
    const [running, setRunning] = useState(false);
    useEffect(() => {
      if (!running) return;
      const timerId = setInterval(() => {
        setRemaining((value) => {
          if (value <= 1) {
            setRunning(false);
            return 0;
          }
          return value - 1;
        });
      }, 1e3);
      return () => clearInterval(timerId);
    }, [running]);
    return /* @__PURE__ */ React.createElement("div", { className: "h-full flex flex-col items-center justify-center gap-5" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold" }, slide.title), /* @__PURE__ */ React.createElement("p", { className: "text-6xl font-mono" }, Math.floor(remaining / 60).toString().padStart(2, "0"), ":", (remaining % 60).toString().padStart(2, "0")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-emerald-600 text-white", onClick: () => setRunning(true) }, "Start"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-amber-500 text-white", onClick: () => setRunning(false) }, "Pause"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-slate-600 text-white", onClick: () => {
      setRunning(false);
      setRemaining(slide.duration || 60);
    } }, "Reset")));
  }
  function PollSlide({ slide, lessonId, results, setResults }) {
    const slideKey = `${lessonId}:${slide.id}`;
    const votes = results[slideKey] || {};
    const totalVotes = Object.values(votes).reduce((sum, value) => sum + value, 0);
    const castVote = (option) => {
      const updated = {
        ...results,
        [slideKey]: {
          ...votes,
          [option]: (votes[option] || 0) + 1
        }
      };
      setResults(updated);
      writeStorage(STORAGE_KEYS.pollResults, updated);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold mb-6" }, slide.title), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, slide.options.map((option) => {
      const voteCount = votes[option] || 0;
      const width = totalVotes ? `${voteCount / totalVotes * 100}%` : "0%";
      return /* @__PURE__ */ React.createElement("button", { key: option, onClick: () => castVote(option), className: "block w-full text-left rounded border border-slate-300 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2 bg-white relative" }, /* @__PURE__ */ React.createElement("span", { className: "relative z-10 font-medium" }, option, " (", voteCount, ")"), /* @__PURE__ */ React.createElement("span", { className: "absolute inset-y-0 left-0 bg-indigo-200", style: { width } })));
    })));
  }
  function ScenarioSlide({ slide, lessonId, results, setResults }) {
    const selectionKey = `${lessonId}:${slide.id}:selection`;
    const selectedChoice = results[selectionKey] || "";
    const selectChoice = (choice) => {
      const updated = {
        ...results,
        [selectionKey]: choice
      };
      setResults(updated);
      writeStorage(STORAGE_KEYS.pollResults, updated);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8 flex flex-col items-center justify-center text-center gap-6" }, /* @__PURE__ */ React.createElement("h2", { className: "text-4xl font-bold" }, slide.title), /* @__PURE__ */ React.createElement("p", { className: "text-2xl max-w-3xl" }, slide.text), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap justify-center gap-3" }, (slide.choices || []).map((choice) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: choice,
        onClick: () => selectChoice(choice),
        className: `px-4 py-2 rounded border ${selectedChoice === choice ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-900 border-slate-300"}`
      },
      choice
    ))));
  }
  function RetrievalSlide({ slide }) {
    const [revealed, setRevealed] = useState(false);
    const hasAnswers = Array.isArray(slide.answers) && slide.answers.some((answer) => Boolean(answer));
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8 flex flex-col gap-6" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold" }, "Retrieval Practice"), /* @__PURE__ */ React.createElement("ol", { className: "list-decimal pl-8 space-y-3 text-xl" }, (slide.questions || []).map((question, index) => /* @__PURE__ */ React.createElement("li", { key: `${question}-${index}`, className: !hasAnswers && revealed ? "font-semibold text-indigo-700" : "" }, /* @__PURE__ */ React.createElement("p", null, question), hasAnswers && revealed && slide.answers[index] ? /* @__PURE__ */ React.createElement("p", { className: "text-base text-slate-600 mt-1" }, "Answer: ", slide.answers[index]) : null))), /* @__PURE__ */ React.createElement("button", { className: "self-start px-4 py-2 rounded bg-indigo-600 text-white", onClick: () => setRevealed((value) => !value) }, revealed ? "Hide Answers" : "Reveal Answers"));
  }
  function TPSSlide({ slide }) {
    const defaultThinkTime = Number(slide.thinkTime) || 60;
    const [remaining, setRemaining] = useState(defaultThinkTime);
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState("think");
    useEffect(() => {
      if (phase !== "think" || !running) return;
      const timerId = setInterval(() => {
        setRemaining((value) => {
          if (value <= 1) {
            setRunning(false);
            setPhase("pair");
            return 0;
          }
          return value - 1;
        });
      }, 1e3);
      return () => clearInterval(timerId);
    }, [phase, running]);
    useEffect(() => {
      setRemaining(defaultThinkTime);
      setRunning(false);
      setPhase("think");
    }, [slide.id, defaultThinkTime]);
    const skipPhase = () => {
      if (phase === "think") {
        setRunning(false);
        setRemaining(0);
        setPhase("pair");
        return;
      }
      if (phase === "pair") setPhase("share");
    };
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8 flex flex-col items-center justify-center text-center gap-5" }, /* @__PURE__ */ React.createElement("h2", { className: "text-4xl font-bold max-w-4xl" }, slide.question), phase === "think" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "text-2xl font-semibold" }, "Think quietly"), /* @__PURE__ */ React.createElement("p", { className: "text-6xl font-mono" }, Math.floor(remaining / 60).toString().padStart(2, "0"), ":", (remaining % 60).toString().padStart(2, "0")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-emerald-600 text-white", onClick: () => setRunning(true) }, "Start"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-amber-500 text-white", onClick: () => setRunning(false) }, "Pause"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-slate-600 text-white", onClick: () => {
      setRunning(false);
      setRemaining(defaultThinkTime);
    } }, "Reset"))) : null, phase === "pair" ? /* @__PURE__ */ React.createElement("p", { className: "text-3xl font-semibold" }, "Pair and discuss") : null, phase === "share" ? /* @__PURE__ */ React.createElement("p", { className: "text-3xl font-semibold" }, "Share with class") : null, phase !== "share" ? /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-indigo-600 text-white", onClick: skipPhase }, "Skip to next phase") : null);
  }
  function ReflectionSlide({ slide, lessonId }) {
    const storageKey = `${lessonId}:${slide.id}`;
    const [value, setValue] = useState(() => readStorage(STORAGE_KEYS.reflections, {})[storageKey] || "");
    const onSave = () => {
      const reflections = readStorage(STORAGE_KEYS.reflections, {});
      const updated = { ...reflections, [storageKey]: value };
      writeStorage(STORAGE_KEYS.reflections, updated);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8 flex flex-col gap-4" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold" }, slide.title), /* @__PURE__ */ React.createElement("p", { className: "text-slate-500" }, slide.prompt), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "w-full h-52 rounded border border-slate-300 p-3",
        placeholder: "Type student or class reflections here...",
        value,
        onChange: (event) => setValue(event.target.value)
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "self-start px-4 py-2 rounded bg-indigo-600 text-white", onClick: onSave }, "Save reflection"));
  }
  function RandomNameSlide({ slide, classList, onPick, currentName }) {
    return /* @__PURE__ */ React.createElement("div", { className: "h-full p-8 flex flex-col items-center justify-center gap-5" }, /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-bold" }, slide.title), /* @__PURE__ */ React.createElement("p", { className: "text-slate-500" }, slide.prompt), /* @__PURE__ */ React.createElement("p", { className: "text-4xl font-semibold" }, currentName || "Tap to pick a student"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-2 rounded bg-indigo-600 text-white disabled:bg-slate-400", onClick: onPick, disabled: !classList.length }, "Pick random student"), !classList.length ? /* @__PURE__ */ React.createElement("p", { className: "text-sm text-red-500" }, "Add students in the teacher toolbar first.") : null);
  }
  function TeacherToolbar({ onAction, classList, setClassList, theme, setTheme, onUploadLogo }) {
    const [classDraft, setClassDraft] = useState(classList.join(", "));
    const saveClassList = () => {
      const parsed = classDraft.split(",").map((item) => item.trim()).filter(Boolean);
      setClassList(parsed);
      writeStorage(STORAGE_KEYS.classList, parsed);
    };
    return /* @__PURE__ */ React.createElement("aside", { className: "w-full md:w-80 border-r border-slate-300 p-4 flex flex-col gap-3 bg-white/90" }, /* @__PURE__ */ React.createElement("h2", { className: "text-xl font-bold" }, "Teacher Toolbar"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-indigo-600 text-white", onClick: () => onAction("timer") }, "Open timer slide"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-indigo-600 text-white", onClick: () => onAction("poll") }, "Run poll"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-indigo-600 text-white", onClick: () => onAction("randomName") }, "Pick random student"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-indigo-600 text-white", onClick: () => onAction("drill") }, "Show drill description"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-rose-600 text-white", onClick: () => onAction("end") }, "End lesson"), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-slate-200 space-y-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold" }, "Class list"), /* @__PURE__ */ React.createElement("textarea", { className: "w-full h-24 rounded border p-2", value: classDraft, onChange: (event) => setClassDraft(event.target.value) }), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-slate-700 text-white", onClick: saveClassList }, "Save class list")), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-slate-200 space-y-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold" }, "Theme"), /* @__PURE__ */ React.createElement("select", { className: "w-full rounded border p-2", value: theme, onChange: (event) => setTheme(event.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "light" }, "Light"), /* @__PURE__ */ React.createElement("option", { value: "dark" }, "Dark"))), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-slate-200 space-y-2" }, /* @__PURE__ */ React.createElement("h3", { className: "font-semibold" }, "School logo"), /* @__PURE__ */ React.createElement("input", { type: "file", accept: "image/*", onChange: onUploadLogo })));
  }
  function LessonHistory({ lessons }) {
    const [query, setQuery] = useState("");
    const filtered = lessons.filter((lesson) => lesson.title.toLowerCase().includes(query.toLowerCase()));
    return /* @__PURE__ */ React.createElement("section", { className: "p-4 bg-white rounded border border-slate-300" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xl font-bold mb-3" }, "Saved lesson history"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "w-full border rounded p-2 mb-3",
        placeholder: "Search by title",
        value: query,
        onChange: (event) => setQuery(event.target.value)
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "space-y-2 max-h-52 overflow-auto" }, filtered.map((lesson) => /* @__PURE__ */ React.createElement("article", { key: lesson.id + lesson.date, className: "rounded border p-3" }, /* @__PURE__ */ React.createElement("h4", { className: "font-semibold" }, lesson.title), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-slate-500" }, new Date(lesson.date).toLocaleString(), " \xB7 ", lesson.slides.length, " slides"))), !filtered.length ? /* @__PURE__ */ React.createElement("p", { className: "text-sm text-slate-500" }, "No lessons match this search.") : null));
  }
  function App() {
    const [lesson, setLesson] = useState(() => readStorage(STORAGE_KEYS.currentLesson, defaultLesson));
    const [horizontalIndex, setHorizontalIndex] = useState(0);
    const [verticalIndex, setVerticalIndex] = useState(0);
    const [revealedBullets, setRevealedBullets] = useState({});
    const [pollResults, setPollResults] = useState(() => readStorage(STORAGE_KEYS.pollResults, {}));
    const [classList, setClassList] = useState(() => readStorage(STORAGE_KEYS.classList, []));
    const [pickedName, setPickedName] = useState("");
    const [theme, setTheme] = useState(() => readStorage(STORAGE_KEYS.theme, "light"));
    const [logo, setLogo] = useState(() => readStorage(STORAGE_KEYS.logo, ""));
    const [view, setView] = useState("present");
    const [showImportModal, setShowImportModal] = useState(false);
    const [lessonImportValue, setLessonImportValue] = useState("");
    const [importError, setImportError] = useState("");
    const touchStart = useRef(null);
    const slides = lesson.slides;
    const currentSlide = slides[horizontalIndex];
    const visibleSlide = currentSlide.type === "stack" ? currentSlide.steps[verticalIndex] : currentSlide;
    useEffect(() => {
      const savedLessons = readStorage(STORAGE_KEYS.lessons, []);
      const hasLesson = savedLessons.some((item) => item.id === lesson.id);
      if (!hasLesson) {
        writeStorage(STORAGE_KEYS.lessons, [lesson, ...savedLessons]);
      }
    }, [lesson]);
    useEffect(() => {
      writeStorage(STORAGE_KEYS.currentLesson, lesson);
    }, [lesson]);
    useEffect(() => {
      writeStorage(STORAGE_KEYS.theme, theme);
    }, [theme]);
    const jumpToType = (type) => {
      const targetIndex = slides.findIndex((slide) => slide.type === type || slide.type === "stack" && slide.steps.some((step) => step.type === type));
      if (targetIndex >= 0) {
        setHorizontalIndex(targetIndex);
        setVerticalIndex(0);
      }
    };
    const navigateHorizontal = (direction) => {
      setVerticalIndex(0);
      setHorizontalIndex((value) => Math.min(slides.length - 1, Math.max(0, value + direction)));
    };
    const navigateVertical = (direction) => {
      if (currentSlide.type !== "stack") return;
      setVerticalIndex((value) => Math.min(currentSlide.steps.length - 1, Math.max(0, value + direction)));
    };
    const revealNextBullet = (slideId, total) => {
      setRevealedBullets((value) => ({
        ...value,
        [slideId]: Math.min(total, (value[slideId] || 0) + 1)
      }));
    };
    useEffect(() => {
      const onKeyDown = (event) => {
        if (event.key === "ArrowRight") navigateHorizontal(1);
        if (event.key === "ArrowLeft") navigateHorizontal(-1);
        if (event.key === "ArrowUp") navigateVertical(-1);
        if (event.key === "ArrowDown") navigateVertical(1);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    });
    const handleTouchStart = (event) => {
      touchStart.current = event.changedTouches[0];
    };
    const handleTouchEnd = (event) => {
      if (!touchStart.current) return;
      const end = event.changedTouches[0];
      const deltaX = end.clientX - touchStart.current.clientX;
      const deltaY = end.clientY - touchStart.current.clientY;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX > 40) navigateHorizontal(-1);
        if (deltaX < -40) navigateHorizontal(1);
      } else {
        if (deltaY > 40) navigateVertical(-1);
        if (deltaY < -40) navigateVertical(1);
      }
      touchStart.current = null;
    };
    const onToolbarAction = (action) => {
      if (action === "timer") jumpToType("timer");
      if (action === "poll") jumpToType("poll");
      if (action === "randomName") {
        jumpToType("randomName");
        if (classList.length) {
          setPickedName(classList[Math.floor(Math.random() * classList.length)]);
        }
      }
      if (action === "drill") alert("Drill: 30s sprint, 20s recover, repeat 6 rounds.");
      if (action === "end") setView("history");
    };
    const onUploadLogo = (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const encoded = typeof reader.result === "string" ? reader.result : "";
        setLogo(encoded);
        writeStorage(STORAGE_KEYS.logo, encoded);
      };
      reader.readAsDataURL(file);
    };
    const lessons = useMemo(() => readStorage(STORAGE_KEYS.lessons, []), [view]);
    const deckTheme = theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-900";
    const importLesson = () => {
      try {
        const parsed = JSON.parse(lessonImportValue);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slides) || typeof parsed.title !== "string") {
          setImportError("Lesson JSON must include a title and slides array.");
          return;
        }
        const normalizedSlides = parsed.slides.map((slide, index) => {
          if (!slide || typeof slide !== "object" || typeof slide.type !== "string") {
            throw new Error(`Slide ${index + 1} is invalid.`);
          }
          if (slide.type === "title") {
            return { id: `import-${index + 1}`, type: "title", title: slide.heading || "", subtitle: slide.subheading || "" };
          }
          if (slide.type === "list") {
            return { id: `import-${index + 1}`, type: "list", title: slide.heading || "", bullets: Array.isArray(slide.items) ? slide.items : [] };
          }
          if (slide.type === "timer") {
            return { id: `import-${index + 1}`, type: "timer", title: "Timer", duration: Number(slide.duration) || 60 };
          }
          if (slide.type === "poll") {
            return { id: `import-${index + 1}`, type: "poll", title: slide.question || "Poll", options: Array.isArray(slide.options) ? slide.options : [] };
          }
          if (slide.type === "reflection") {
            return { id: `import-${index + 1}`, type: "reflection", title: "Reflection", prompt: slide.prompt || "" };
          }
          if (slide.type === "scenario") {
            return {
              id: `import-${index + 1}`,
              type: "scenario",
              title: slide.title || "Decision Time",
              text: slide.text || "",
              choices: Array.isArray(slide.choices) ? slide.choices : []
            };
          }
          if (slide.type === "retrieval") {
            return {
              id: `import-${index + 1}`,
              type: "retrieval",
              questions: Array.isArray(slide.questions) ? slide.questions : [],
              answers: Array.isArray(slide.answers) ? slide.answers : []
            };
          }
          if (slide.type === "tps") {
            return {
              id: `import-${index + 1}`,
              type: "tps",
              question: slide.question || "",
              thinkTime: Number(slide.thinkTime) || 60
            };
          }
          throw new Error(`Unsupported slide type: ${slide.type}`);
        });
        const nextLesson = {
          id: `lesson-${Date.now()}`,
          title: parsed.title,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          slides: normalizedSlides
        };
        setLesson(nextLesson);
        setHorizontalIndex(0);
        setVerticalIndex(0);
        setRevealedBullets({});
        writeStorage(STORAGE_KEYS.currentLesson, nextLesson);
        setShowImportModal(false);
        setLessonImportValue("");
        setImportError("");
        setView("present");
      } catch (error) {
        setImportError(error instanceof Error ? error.message : "Invalid JSON");
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: `${deckTheme} min-h-screen` }, /* @__PURE__ */ React.createElement("header", { className: "p-4 border-b border-slate-300 flex items-center justify-between" }, /* @__PURE__ */ React.createElement("h1", { className: "text-2xl font-bold" }, "Daniel's Deck"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded border", onClick: () => setShowImportModal(true) }, "Import Lesson"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded border", onClick: () => setView("present") }, "Presentation"), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded border", onClick: () => setView("history") }, "Saved lessons"))), showImportModal ? /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-full max-w-2xl bg-white text-slate-900 rounded-lg border border-slate-300 p-4 space-y-3" }, /* @__PURE__ */ React.createElement("h2", { className: "text-lg font-semibold" }, "Import lesson JSON"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "w-full h-72 rounded border border-slate-300 p-3 font-mono text-sm",
        placeholder: "Paste lesson JSON here...",
        value: lessonImportValue,
        onChange: (event) => setLessonImportValue(event.target.value)
      }
    ), importError ? /* @__PURE__ */ React.createElement("p", { className: "text-sm text-rose-600" }, importError) : null, /* @__PURE__ */ React.createElement("div", { className: "flex justify-end gap-2" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "px-3 py-2 rounded border",
        onClick: () => {
          setShowImportModal(false);
          setImportError("");
        }
      },
      "Cancel"
    ), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-indigo-600 text-white", onClick: importLesson }, "Load Lesson")))) : null, /* @__PURE__ */ React.createElement("main", { className: "flex flex-col md:flex-row" }, /* @__PURE__ */ React.createElement(
      TeacherToolbar,
      {
        onAction: onToolbarAction,
        classList,
        setClassList,
        theme,
        setTheme,
        onUploadLogo
      }
    ), /* @__PURE__ */ React.createElement("section", { className: "flex-1 p-4" }, view === "history" ? /* @__PURE__ */ React.createElement(LessonHistory, { lessons }) : /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "h-[70vh] rounded-xl border border-slate-300 bg-white text-slate-900 overflow-hidden",
        onTouchStart: handleTouchStart,
        onTouchEnd: handleTouchEnd
      },
      (() => {
        switch (visibleSlide.type) {
          case "title":
            return /* @__PURE__ */ React.createElement(TitleSlide, { slide: visibleSlide, logo });
          case "list":
            return /* @__PURE__ */ React.createElement(
              ListSlide,
              {
                slide: visibleSlide,
                revealCount: revealedBullets[visibleSlide.id] || 0,
                onRevealNext: () => revealNextBullet(visibleSlide.id, visibleSlide.bullets.length)
              }
            );
          case "timer":
            return /* @__PURE__ */ React.createElement(TimerSlide, { slide: visibleSlide });
          case "poll":
            return /* @__PURE__ */ React.createElement(PollSlide, { slide: visibleSlide, lessonId: lesson.id, results: pollResults, setResults: setPollResults });
          case "reflection":
            return /* @__PURE__ */ React.createElement(ReflectionSlide, { slide: visibleSlide, lessonId: lesson.id });
          case "randomName":
            return /* @__PURE__ */ React.createElement(
              RandomNameSlide,
              {
                slide: visibleSlide,
                classList,
                currentName: pickedName,
                onPick: () => setPickedName(classList[Math.floor(Math.random() * classList.length)] || "")
              }
            );
          case "scenario":
            return /* @__PURE__ */ React.createElement(ScenarioSlide, { slide: visibleSlide, lessonId: lesson.id, results: pollResults, setResults: setPollResults });
          case "retrieval":
            return /* @__PURE__ */ React.createElement(RetrievalSlide, { slide: visibleSlide });
          case "tps":
            return /* @__PURE__ */ React.createElement(TPSSlide, { slide: visibleSlide });
          default:
            return /* @__PURE__ */ React.createElement("div", { className: "h-full flex items-center justify-center text-slate-500" }, "Unsupported slide type: ", visibleSlide.type);
        }
      })()
    ), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between mt-3" }, /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-slate-700 text-white", onClick: () => navigateHorizontal(-1) }, "\u2190 Previous"), /* @__PURE__ */ React.createElement("p", { className: "text-sm self-center" }, "Slide ", horizontalIndex + 1, " / ", slides.length, currentSlide.type === "stack" ? ` \xB7 Step ${verticalIndex + 1}/${currentSlide.steps.length}` : ""), /* @__PURE__ */ React.createElement("button", { className: "px-3 py-2 rounded bg-slate-700 text-white", onClick: () => navigateHorizontal(1) }, "Next \u2192")))));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
