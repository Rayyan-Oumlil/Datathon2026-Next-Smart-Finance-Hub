'use client';

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shell/Sidebar";
import TabBar from "@/components/shell/TabBar";
import SearchCommand from "@/components/SearchCommand";
import AgentPanel from "@/components/agent/AgentPanel";
import { PANEL_DEFAULT, PANEL_STORAGE_KEY, clampWidth, readStoredWidth } from "@/components/agent/panel-width";
import type { PersonaName } from "@/lib/personas/presets";
import { FORGET_SCROLL_EVENT, useKeepScroll } from "@/hooks/useKeepScroll";
import { cn } from "@/lib/utils";

type AppShellProps = {
    user: User;
    persona?: PersonaName | null;
    initialStocks: StockWithWatchlistStatus[];
    children: React.ReactNode;
};

const AppShell = ({ user, persona = null, initialStocks, children }: AppShellProps) => {
    const pathname = usePathname();
    const [navOpen, setNavOpen] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);
    const workspaceRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const slotRef = useRef<HTMLDivElement>(null);
    const roomRef = useRef<HTMLDivElement>(null);
    // Pressing a button never moves the page: a part that gets shorter does not pull the view up (hooks/useKeepScroll.ts)
    const { reset: forgetScroll } = useKeepScroll({ scroller: workspaceRef, content: contentRef, room: roomRef, watch: [slotRef] });
    // The agent panel's width on a wide screen: dragged or swiped by the visitor, kept in this browser
    const [agentWidth, setAgentWidth] = useState(PANEL_DEFAULT);
    useEffect(() => {
        try { setAgentWidth(clampWidth(readStoredWidth(localStorage.getItem(PANEL_STORAGE_KEY)), window.innerWidth)); } catch { /* storage blocked: the default width */ }
    }, []);
    // A narrower window shrinks a panel that no longer fits
    useEffect(() => {
        const fit = () => setAgentWidth((width) => clampWidth(width, window.innerWidth));
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, []);
    const resizeAgent = (width: number, final: boolean) => {
        const next = clampWidth(width, window.innerWidth);
        setAgentWidth(next);
        if (final) { try { localStorage.setItem(PANEL_STORAGE_KEY, String(next)); } catch { /* private mode: applies for this visit */ } }
    };

    // The workspace is the scroll container, so reset it when the visitor goes to another page. Only the path counts:
    // a filter in the address (?market=), a refresh or a saved change leaves the view where it is.
    useEffect(() => {
        setNavOpen(false);
        forgetScroll();
        workspaceRef.current?.scrollTo({ top: 0 });
    }, [pathname, forgetScroll]);
    // A view change on the same path that should start at the top (a strategy opened, a full replay) asks for it
    useEffect(() => {
        window.addEventListener(FORGET_SCROLL_EVENT, forgetScroll);
        return () => window.removeEventListener(FORGET_SCROLL_EVENT, forgetScroll);
    }, [forgetScroll]);

    return (
        <div className={cn('shell', agentOpen && 'lg:grid-cols-[248px_minmax(0,1fr)_var(--agent-w)]')} style={{ '--agent-w': `${agentWidth}px` } as React.CSSProperties}>
            <div
                className={cn(
                    // The drawer slides in from the left
                    'min-h-0 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:rtl:left-auto max-lg:rtl:right-0 max-lg:z-50 max-lg:w-[272px] max-lg:transition-transform max-lg:duration-200',
                    navOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full',
                )}
            >
                <Sidebar user={user} persona={persona} />
            </div>
            {navOpen && (
                <div className="fixed inset-0 z-40 bg-page/60 backdrop-blur-[2px] lg:hidden" onClick={() => setNavOpen(false)} />
            )}

            <div className="shell-container">
                {/* Without open stock tabs the tab bar is not rendered: the workspace then takes the whole frame */}
                <div className={cn('app',
                    '[&:not(:has(>.tabbar))]:[grid-template-rows:minmax(0,1fr)] [&:not(:has(>.tabbar))>.workspace]:rounded-none',
                    'max-lg:[&:not(:has(>.tabbar))_.workspace-inner]:pt-14')}>
                    <TabBar onMenu={() => setNavOpen(true)} />
                    <main ref={workspaceRef} className={cn('workspace', pathname === '/portfolio' && 'is-first-tab')}>
                        {/* Where a change proposed by the agent is shown with its details and Save button (the agent panel fills it) */}
                        <div id="agent-proposal-slot" ref={slotRef} className="px-4 pt-4 empty:hidden max-lg:px-3 max-lg:pt-3" style={{ maxWidth: 1680 }} />
                        {/* A change applied by the agent does not mount the page again (an emptied page loses its scroll
                            position): the pages read their data again in place (hooks/useDataChanged.ts, router.refresh) */}
                        <div className="workspace-inner" ref={contentRef}>
                            {children}
                        </div>
                        {/* Empty unless the page got shorter than where the visitor is: see useKeepScroll */}
                        <div ref={roomRef} aria-hidden="true" />
                    </main>
                </div>
            </div>

            <AgentPanel owner={persona ?? user.id ?? ''} open={agentOpen} onOpenChange={setAgentOpen} width={agentWidth} onResize={resizeAgent} />

            <SearchCommand initialStocks={initialStocks} />
        </div>
    );
};

export default AppShell;
