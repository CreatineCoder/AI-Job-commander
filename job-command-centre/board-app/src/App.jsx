import { useCallback, useEffect, useRef, useState } from "react";
import { AppContext } from "./AppContext.jsx";
import { getClient } from "./lib/lemma.js";
import { loadData, ensurePermissions } from "./lib/data.js";
import { useTheme } from "./hooks/useTheme.js";
import Loading from "./components/Loading.jsx";
import SignIn from "./components/SignIn.jsx";
import Fatal from "./components/Fatal.jsx";
import Header from "./components/Header.jsx";
import StatBar from "./components/StatBar.jsx";
import FollowupBanner from "./components/FollowupBanner.jsx";
import Board from "./components/Board.jsx";
import AddJobModal from "./components/AddJobModal.jsx";
import DetailPage from "./components/DetailPage.jsx";

// Hash route → view. `#/job/<id>` opens the detail page; anything else is the board.
function parseHash() {
  const m = (window.location.hash || "").match(/^#\/job\/(.+)$/);
  return m ? { name: "detail", id: decodeURIComponent(m[1]) } : { name: "board" };
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [phase, setPhase] = useState("loading"); // loading | signin | ready | error
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [followups, setFollowups] = useState({});
  const [view, setView] = useState(parseHash); // {name:'board'} | {name:'detail', id}
  const [addOpen, setAddOpen] = useState(false);

  const clientRef = useRef(null);
  // Whether we've confirmed Gmail is connected this session (shared, mutable).
  const gmail = useRef({ connected: null });

  const reload = useCallback(async () => {
    const { rows, followups } = await loadData(clientRef.current);
    setRows(rows);
    setFollowups(followups);
    return { rows, followups };
  }, []);

  // Keep the view in sync with the URL so the browser Back/Forward buttons work.
  useEffect(() => {
    const onNav = () => setView(parseHash());
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { client, auth } = await getClient();
        if (cancelled) return;
        clientRef.current = client;
        if (auth.status !== "authenticated") {
          setPhase("signin");
          return;
        }
        setUser(auth.user);
        await ensurePermissions(client);
        await reload();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setError((e && e.message) || "Something went wrong.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const openDetail = useCallback((id) => {
    window.history.pushState({}, "", "#/job/" + encodeURIComponent(id));
    setView({ name: "detail", id });
    window.scrollTo(0, 0);
  }, []);

  const goBoard = useCallback(() => {
    if ((window.location.hash || "").startsWith("#/job/")) {
      window.history.back(); // pop the detail entry; popstate restores the board view
    } else {
      setView({ name: "board" });
    }
  }, []);

  if (phase === "loading") return <Loading />;
  if (phase === "error") return <Fatal message={error} />;
  if (phase === "signin") return <SignIn client={clientRef.current} />;

  const ctx = {
    client: clientRef.current,
    rows,
    followups,
    user,
    reload,
    gmail: gmail.current,
    openDetail,
    openAdd: () => setAddOpen(true),
    closeModal: () => setAddOpen(false),
  };

  return (
    <AppContext.Provider value={ctx}>
      {view.name === "detail" ? (
        <DetailPage id={view.id} onBack={goBoard} />
      ) : (
        <>
          <div className="wrap">
            <Header
              user={user}
              client={clientRef.current}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
            <StatBar rows={rows} onAdd={ctx.openAdd} />
            <FollowupBanner rows={rows} followups={followups} />
            <Board rows={rows} followups={followups} onOpen={openDetail} />
          </div>
          {addOpen && <AddJobModal onClose={ctx.closeModal} />}
        </>
      )}
    </AppContext.Provider>
  );
}
