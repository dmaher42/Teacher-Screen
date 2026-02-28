const { useEffect, useMemo, useState, useRef } = React;

const STORAGE_KEYS = {
  lessons: 'daniels-deck-lessons',
  pollResults: 'daniels-deck-poll-results',
  reflections: 'daniels-deck-reflections',
  classList: 'daniels-deck-class-list',
  theme: 'daniels-deck-theme',
  logo: 'daniels-deck-logo'
};

const defaultSlides = [
  { id: 's1', type: 'title', title: 'Year 7 Civics', subtitle: 'Rights, Responsibilities, and Community' },
  { id: 's2', type: 'list', title: 'Learning Goals', bullets: ['Explain civic responsibility', 'Identify active citizenship examples', 'Connect civics to school life'] },
  { id: 's3', type: 'timer', title: 'Think-Pair-Share', duration: 120 },
  { id: 's4', type: 'poll', title: 'Which civic action has strongest impact?', options: ['Voting', 'Volunteering', 'Petitioning', 'Community meetings'] },
  { id: 's5', type: 'reflection', title: 'Reflection Prompt', prompt: 'What is one action you can take this week to improve your community?' },
  { id: 's6', type: 'randomName', title: 'Random Speaker', prompt: 'Who would like to share first?' },
  {
    id: 's7',
    type: 'stack',
    title: 'Coaching Drill Walkthrough',
    steps: [
      { id: 's7-1', type: 'title', title: 'Drill Step 1', subtitle: 'Set up cones and assign pairs' },
      { id: 's7-2', type: 'list', title: 'Drill Step 2', bullets: ['30 second sprint', '20 second recover', 'Repeat for 6 rounds'] },
      { id: 's7-3', type: 'reflection', title: 'Drill Debrief', prompt: 'What made this drill challenging today?' }
    ]
  }
];

const defaultLesson = {
  id: 'lesson-default',
  title: 'Daniel\'s Deck Starter Session',
  date: new Date().toISOString(),
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
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-4">
      {logo ? <img src={logo} alt="School logo" className="h-20 object-contain" /> : null}
      <h1 className="text-4xl font-bold">{slide.title}</h1>
      <p className="text-xl text-slate-500">{slide.subtitle}</p>
    </div>
  );
}

function ListSlide({ slide, revealCount, onRevealNext }) {
  return (
    <div className="h-full p-8">
      <h2 className="text-3xl font-bold mb-6">{slide.title}</h2>
      <ul className="space-y-3 list-disc pl-8 text-xl">
        {slide.bullets.map((bullet, index) => (
          <li key={bullet} className={index < revealCount ? 'opacity-100' : 'opacity-20'}>
            {bullet}
          </li>
        ))}
      </ul>
      <button onClick={onRevealNext} className="mt-8 px-4 py-2 rounded bg-indigo-600 text-white">
        Reveal next point
      </button>
    </div>
  );
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
    }, 1000);

    return () => clearInterval(timerId);
  }, [running]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-5">
      <h2 className="text-3xl font-bold">{slide.title}</h2>
      <p className="text-6xl font-mono">{Math.floor(remaining / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</p>
      <div className="flex gap-2">
        <button className="px-4 py-2 rounded bg-emerald-600 text-white" onClick={() => setRunning(true)}>Start</button>
        <button className="px-4 py-2 rounded bg-amber-500 text-white" onClick={() => setRunning(false)}>Pause</button>
        <button className="px-4 py-2 rounded bg-slate-600 text-white" onClick={() => { setRunning(false); setRemaining(slide.duration || 60); }}>Reset</button>
      </div>
    </div>
  );
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

  return (
    <div className="h-full p-8">
      <h2 className="text-3xl font-bold mb-6">{slide.title}</h2>
      <div className="space-y-4">
        {slide.options.map((option) => {
          const voteCount = votes[option] || 0;
          const width = totalVotes ? `${(voteCount / totalVotes) * 100}%` : '0%';
          return (
            <button key={option} onClick={() => castVote(option)} className="block w-full text-left rounded border border-slate-300 overflow-hidden">
              <div className="px-3 py-2 bg-white relative">
                <span className="relative z-10 font-medium">{option} ({voteCount})</span>
                <span className="absolute inset-y-0 left-0 bg-indigo-200" style={{ width }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReflectionSlide({ slide, lessonId }) {
  const storageKey = `${lessonId}:${slide.id}`;
  const [value, setValue] = useState(() => readStorage(STORAGE_KEYS.reflections, {})[storageKey] || '');

  const onSave = () => {
    const reflections = readStorage(STORAGE_KEYS.reflections, {});
    const updated = { ...reflections, [storageKey]: value };
    writeStorage(STORAGE_KEYS.reflections, updated);
  };

  return (
    <div className="h-full p-8 flex flex-col gap-4">
      <h2 className="text-3xl font-bold">{slide.title}</h2>
      <p className="text-slate-500">{slide.prompt}</p>
      <textarea
        className="w-full h-52 rounded border border-slate-300 p-3"
        placeholder="Type student or class reflections here..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="self-start px-4 py-2 rounded bg-indigo-600 text-white" onClick={onSave}>Save reflection</button>
    </div>
  );
}

function RandomNameSlide({ slide, classList, onPick, currentName }) {
  return (
    <div className="h-full p-8 flex flex-col items-center justify-center gap-5">
      <h2 className="text-3xl font-bold">{slide.title}</h2>
      <p className="text-slate-500">{slide.prompt}</p>
      <p className="text-4xl font-semibold">{currentName || 'Tap to pick a student'}</p>
      <button className="px-4 py-2 rounded bg-indigo-600 text-white disabled:bg-slate-400" onClick={onPick} disabled={!classList.length}>
        Pick random student
      </button>
      {!classList.length ? <p className="text-sm text-red-500">Add students in the teacher toolbar first.</p> : null}
    </div>
  );
}

function TeacherToolbar({ onAction, classList, setClassList, theme, setTheme, onUploadLogo }) {
  const [classDraft, setClassDraft] = useState(classList.join(', '));

  const saveClassList = () => {
    const parsed = classDraft.split(',').map((item) => item.trim()).filter(Boolean);
    setClassList(parsed);
    writeStorage(STORAGE_KEYS.classList, parsed);
  };

  return (
    <aside className="w-full md:w-80 border-r border-slate-300 p-4 flex flex-col gap-3 bg-white/90">
      <h2 className="text-xl font-bold">Teacher Toolbar</h2>
      <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={() => onAction('timer')}>Open timer slide</button>
      <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={() => onAction('poll')}>Run poll</button>
      <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={() => onAction('randomName')}>Pick random student</button>
      <button className="px-3 py-2 rounded bg-indigo-600 text-white" onClick={() => onAction('drill')}>Show drill description</button>
      <button className="px-3 py-2 rounded bg-rose-600 text-white" onClick={() => onAction('end')}>End lesson</button>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <h3 className="font-semibold">Class list</h3>
        <textarea className="w-full h-24 rounded border p-2" value={classDraft} onChange={(event) => setClassDraft(event.target.value)} />
        <button className="px-3 py-2 rounded bg-slate-700 text-white" onClick={saveClassList}>Save class list</button>
      </div>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <h3 className="font-semibold">Theme</h3>
        <select className="w-full rounded border p-2" value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <h3 className="font-semibold">School logo</h3>
        <input type="file" accept="image/*" onChange={onUploadLogo} />
      </div>
    </aside>
  );
}

function LessonHistory({ lessons }) {
  const [query, setQuery] = useState('');

  const filtered = lessons.filter((lesson) => lesson.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="p-4 bg-white rounded border border-slate-300">
      <h3 className="text-xl font-bold mb-3">Saved lesson history</h3>
      <input
        className="w-full border rounded p-2 mb-3"
        placeholder="Search by title"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="space-y-2 max-h-52 overflow-auto">
        {filtered.map((lesson) => (
          <article key={lesson.id + lesson.date} className="rounded border p-3">
            <h4 className="font-semibold">{lesson.title}</h4>
            <p className="text-sm text-slate-500">{new Date(lesson.date).toLocaleString()} · {lesson.slides.length} slides</p>
          </article>
        ))}
        {!filtered.length ? <p className="text-sm text-slate-500">No lessons match this search.</p> : null}
      </div>
    </section>
  );
}

function App() {
  const [lesson] = useState(defaultLesson);
  const [horizontalIndex, setHorizontalIndex] = useState(0);
  const [verticalIndex, setVerticalIndex] = useState(0);
  const [revealedBullets, setRevealedBullets] = useState({});
  const [pollResults, setPollResults] = useState(() => readStorage(STORAGE_KEYS.pollResults, {}));
  const [classList, setClassList] = useState(() => readStorage(STORAGE_KEYS.classList, []));
  const [pickedName, setPickedName] = useState('');
  const [theme, setTheme] = useState(() => readStorage(STORAGE_KEYS.theme, 'light'));
  const [logo, setLogo] = useState(() => readStorage(STORAGE_KEYS.logo, ''));
  const [view, setView] = useState('present');
  const touchStart = useRef(null);

  const slides = lesson.slides;
  const currentSlide = slides[horizontalIndex];
  const visibleSlide = currentSlide.type === 'stack' ? currentSlide.steps[verticalIndex] : currentSlide;

  useEffect(() => {
    const savedLessons = readStorage(STORAGE_KEYS.lessons, []);
    const hasLesson = savedLessons.some((item) => item.id === lesson.id);
    if (!hasLesson) {
      writeStorage(STORAGE_KEYS.lessons, [lesson, ...savedLessons]);
    }
  }, [lesson]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const jumpToType = (type) => {
    const targetIndex = slides.findIndex((slide) => slide.type === type || (slide.type === 'stack' && slide.steps.some((step) => step.type === type)));
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
    if (currentSlide.type !== 'stack') return;
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
      if (event.key === 'ArrowRight') navigateHorizontal(1);
      if (event.key === 'ArrowLeft') navigateHorizontal(-1);
      if (event.key === 'ArrowUp') navigateVertical(-1);
      if (event.key === 'ArrowDown') navigateVertical(1);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
    if (action === 'timer') jumpToType('timer');
    if (action === 'poll') jumpToType('poll');
    if (action === 'randomName') {
      jumpToType('randomName');
      if (classList.length) {
        setPickedName(classList[Math.floor(Math.random() * classList.length)]);
      }
    }
    if (action === 'drill') alert('Drill: 30s sprint, 20s recover, repeat 6 rounds.');
    if (action === 'end') setView('history');
  };

  const onUploadLogo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const encoded = typeof reader.result === 'string' ? reader.result : '';
      setLogo(encoded);
      writeStorage(STORAGE_KEYS.logo, encoded);
    };
    reader.readAsDataURL(file);
  };

  const lessons = useMemo(() => readStorage(STORAGE_KEYS.lessons, []), [view]);
  const deckTheme = theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-900';

  return (
    <div className={`${deckTheme} min-h-screen`}>
      <header className="p-4 border-b border-slate-300 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Daniel's Deck</h1>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border" onClick={() => setView('present')}>Presentation</button>
          <button className="px-3 py-2 rounded border" onClick={() => setView('history')}>Saved lessons</button>
        </div>
      </header>

      <main className="flex flex-col md:flex-row">
        <TeacherToolbar
          onAction={onToolbarAction}
          classList={classList}
          setClassList={setClassList}
          theme={theme}
          setTheme={setTheme}
          onUploadLogo={onUploadLogo}
        />

        <section className="flex-1 p-4">
          {view === 'history' ? (
            <LessonHistory lessons={lessons} />
          ) : (
            <div
              className="h-[70vh] rounded-xl border border-slate-300 bg-white text-slate-900 overflow-hidden"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {visibleSlide.type === 'title' ? <TitleSlide slide={visibleSlide} logo={logo} /> : null}
              {visibleSlide.type === 'list' ? (
                <ListSlide
                  slide={visibleSlide}
                  revealCount={revealedBullets[visibleSlide.id] || 0}
                  onRevealNext={() => revealNextBullet(visibleSlide.id, visibleSlide.bullets.length)}
                />
              ) : null}
              {visibleSlide.type === 'timer' ? <TimerSlide slide={visibleSlide} /> : null}
              {visibleSlide.type === 'poll' ? (
                <PollSlide
                  slide={visibleSlide}
                  lessonId={lesson.id}
                  results={pollResults}
                  setResults={setPollResults}
                />
              ) : null}
              {visibleSlide.type === 'reflection' ? <ReflectionSlide slide={visibleSlide} lessonId={lesson.id} /> : null}
              {visibleSlide.type === 'randomName' ? (
                <RandomNameSlide
                  slide={visibleSlide}
                  classList={classList}
                  currentName={pickedName}
                  onPick={() => setPickedName(classList[Math.floor(Math.random() * classList.length)] || '')}
                />
              ) : null}
            </div>
          )}

          <div className="flex justify-between mt-3">
            <button className="px-3 py-2 rounded bg-slate-700 text-white" onClick={() => navigateHorizontal(-1)}>← Previous</button>
            <p className="text-sm self-center">Slide {horizontalIndex + 1} / {slides.length}{currentSlide.type === 'stack' ? ` · Step ${verticalIndex + 1}/${currentSlide.steps.length}` : ''}</p>
            <button className="px-3 py-2 rounded bg-slate-700 text-white" onClick={() => navigateHorizontal(1)}>Next →</button>
          </div>
        </section>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
