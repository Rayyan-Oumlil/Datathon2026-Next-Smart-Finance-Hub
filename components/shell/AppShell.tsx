'use client';

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/shell/Sidebar";
import TabBar from "@/components/shell/TabBar";
import SearchCommand from "@/components/SearchCommand";
import AgentPanel from "@/components/agent/AgentPanel";
import { cn } from "@/lib/utils";

type AppShellProps = {
    user: User;
    initialStocks: StockWithWatchlistStatus[];
    children: React.ReactNode;
};

const AppShell = ({ user, initialStocks, children }: AppShellProps) => {
    const pathname = usePathname();
    const [navOpen, setNavOpen] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);
    const [dataVersion, setDataVersion] = useState(0);
    const workspaceRef = useRef<HTMLElement>(null);

    // The workspace is the scroll container, so reset it on navigation
    useEffect(() => {
        setNavOpen(false);
        workspaceRef.current?.scrollTo({ top: 0 });
    }, [pathname]);

    return (
        <div className={cn('shell', agentOpen && 'lg:grid-cols-[248px_minmax(0,1fr)_minmax(320px,400px)]')}>
            <div
                className={cn(
                    // The drawer slides in from the reading side: the right in Arabic
                    'min-h-0 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:rtl:left-auto max-lg:rtl:right-0 max-lg:z-50 max-lg:w-[272px] max-lg:transition-transform max-lg:duration-200',
                    navOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full',
                )}
            >
                <Sidebar user={user} />
            </div>
            {navOpen && (
                <div className="fixed inset-0 z-40 bg-page/60 backdrop-blur-[2px] lg:hidden" onClick={() => setNavOpen(false)} />
            )}

            <div className="shell-container">
                <div className="app">
                    <TabBar onMenu={() => setNavOpen(true)} />
                    <main ref={workspaceRef} className={cn('workspace', pathname === '/portfolio' && 'is-first-tab')}>
                        {/* Pages fetch their data when they mount; a change applied by the agent remounts them */}
                        <div className="workspace-inner" key={dataVersion}>
                            {children}
                        </div>
                    </main>
                </div>
            </div>

            <AgentPanel open={agentOpen} onOpenChange={setAgentOpen} onDataChanged={() => setDataVersion((version) => version + 1)} />

            <SearchCommand initialStocks={initialStocks} />
        </div>
    );
};

export default AppShell;
