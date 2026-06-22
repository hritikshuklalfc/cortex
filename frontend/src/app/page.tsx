"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const API_URL = "http://localhost:8000";

// ─── Types ───

interface Message {
  role: "user" | "ai";
  content: string;
  citations?: string[];
  timestamp: Date;
  chartData?: { name: string; value: number }[];
  showChart?: boolean;
}

interface DocumentItem {
  id: number;
  filename: string;
  doc_type: string;
  upload_date: string;
  status: string;
  file_size: number;
  chunk_count: number;
}

// ─── Helpers ───

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileIcon(docType: string): string {
  const map: Record<string, string> = {
    pdf: "description",
    csv: "table_chart",
    txt: "article",
    md: "article",
    json: "database",
    docx: "draft",
  };
  return map[docType] || "insert_drive_file";
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Main Page ───

export default function Home() {
  // Core state
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [activeView, setActiveView] = useState<"dashboard" | "intelligence">("dashboard");
  const [dragActive, setDragActive] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch documents ───
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
      }
    } catch {
      // Backend not reachable
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Poll for ingestion status
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === "pending" || d.status === "processing"
    );
    if (!hasPending) return;
    const interval = setInterval(fetchDocuments, 3000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-dismiss notifications
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  // ─── Show notification ───
  const showNotification = (msg: string) => setNotification(msg);

  // ─── File upload ───
  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append("files", fileList[i]);
    }

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        showNotification(`${data.files.length} file(s) uploaded — processing started`);
        await fetchDocuments();
      } else {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        showNotification(`Upload error: ${err.detail}`);
      }
    } catch {
      showNotification("Upload failed — backend unreachable");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Drag & Drop ───
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFileUpload(e.dataTransfer.files);
  };

  // ─── Delete document ───
  const handleDeleteDoc = async (docId: number, filename: string) => {
    try {
      const res = await fetch(`${API_URL}/documents/${docId}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedFileIds((prev) => prev.filter((id) => id !== docId));
        showNotification(`Deleted "${filename}" and its vectors`);
        await fetchDocuments();
      }
    } catch {
      showNotification("Delete failed");
    }
  };

  // ─── Toggle file selection ───
  const toggleFileSelection = (docId: number) => {
    setSelectedFileIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  // ─── Chat / Query ───
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    const userMessage = query.trim();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage, timestamp: new Date() },
    ]);
    setQuery("");
    setIsLoading(true);

    // Auto-switch to intelligence view when querying
    if (activeView === "dashboard") setActiveView("intelligence");

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          file_ids: selectedFileIds.length > 0 ? selectedFileIds : null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Server error" }));
        throw new Error(errData.detail || "Request failed");
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: data.response,
          citations: data.citations,
          timestamp: new Date(),
          chartData: data.chartData,
          showChart: data.showChart,
        },
      ]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Connection error. Ensure backend is running.";
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: `⚠️ ${errorMessage}`, timestamp: new Date() },
      ]);
    } finally {
      setIsLoading(false);
      chatInputRef.current?.focus();
    }
  };

  // ─── Clear chat ───
  const clearChat = () => {
    setMessages([]);
    showNotification("Chat history cleared");
  };

  // ─── Suggested queries ───
  const suggestedQueries = [
    "Summarize all ingested documents",
    "What safety protocols are documented?",
    "Show maintenance schedule insights",
    "List all equipment failure modes",
  ];

  // ─── Computed stats ───
  const completedDocs = documents.filter((d) => d.status === "completed").length;
  const processingDocs = documents.filter((d) => d.status === "pending" || d.status === "processing").length;
  const failedDocs = documents.filter((d) => d.status === "failed").length;
  const totalChunks = documents.reduce((sum, d) => sum + (d.chunk_count || 0), 0);
  const totalSize = documents.reduce((sum, d) => sum + (d.file_size || 0), 0);
  const queryCount = messages.filter((m) => m.role === "user").length;

  return (
    <div className="selection:bg-[#ffffff] selection:text-[#141313]">
      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-white text-[#141313] px-6 py-3 text-[12px] font-[family-name:var(--font-jetbrains)] uppercase tracking-wider animate-fadeIn flex items-center gap-3">
          <span className="material-symbols-outlined text-[16px]">info</span>
          {notification}
          <button onClick={() => setNotification(null)} className="ml-2 hover:opacity-60">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.csv,.txt,.md,.docx,.json"
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* ═══ LEFT SIDEBAR ═══ */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full z-40 bg-[#141313] w-64 border-r border-[#444748]/10">
        {/* Branding */}
        <div className="p-8">
          <span className="text-headline-sm font-bold text-white tracking-tighter">
            Cortex
          </span>
          <div className="mt-8 flex items-center gap-3">
            <div className="w-8 h-8 border border-[#444748]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[18px]">hub</span>
            </div>
            <div>
              <p className="text-label tracking-widest text-white">Intelligence</p>
              <p className="text-[10px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                {completedDocs > 0 ? `${completedDocs} assets indexed` : "No assets yet"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 mt-4">
          <button
            onClick={() => setActiveView("dashboard")}
            className={`w-full flex items-center gap-4 pl-6 py-3 text-label tracking-[0.2em] transition-all text-left ${
              activeView === "dashboard"
                ? "text-white border-l border-white"
                : "text-[#c4c7c8] hover:text-white hover:bg-[#1c1b1b]"
            }`}
          >
            <span className="material-symbols-outlined">dashboard</span>
            Dashboard
          </button>
          <button
            onClick={() => setActiveView("intelligence")}
            className={`w-full flex items-center gap-4 pl-6 py-3 text-label tracking-[0.2em] transition-all text-left ${
              activeView === "intelligence"
                ? "text-white border-l border-white"
                : "text-[#c4c7c8] hover:text-white hover:bg-[#1c1b1b]"
            }`}
          >
            <span className="material-symbols-outlined">query_stats</span>
            Intelligence
          </button>

          {/* Document list in sidebar */}
          <div className="mt-6 px-4">
            <div className="flex items-center justify-between mb-3 px-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                Documents
              </span>
              <span className="text-[10px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                {documents.length}
              </span>
            </div>
            <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    if (doc.status === "completed") toggleFileSelection(doc.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all group ${
                    selectedFileIds.includes(doc.id)
                      ? "bg-white/5 border-l border-white"
                      : "hover:bg-[#1c1b1b]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px] text-[#c4c7c8] group-hover:text-white">
                    {getFileIcon(doc.doc_type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-white truncate font-[family-name:var(--font-jetbrains)]">
                      {doc.filename}
                    </p>
                    <p className="text-[9px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)] uppercase">
                      {doc.status === "completed"
                        ? `${doc.chunk_count} chunks`
                        : doc.status === "failed"
                          ? "Failed"
                          : "Processing..."}
                    </p>
                  </div>
                  {(doc.status === "pending" || doc.status === "processing") && (
                    <span className="w-2 h-2 bg-[#f59e0b] rounded-full status-pulse" />
                  )}
                  {doc.status === "failed" && (
                    <span className="w-2 h-2 bg-[#ff6b6b] rounded-full" />
                  )}
                  {selectedFileIds.includes(doc.id) && (
                    <span className="material-symbols-outlined text-[12px] text-white">check</span>
                  )}
                </button>
              ))}
              {documents.length === 0 && (
                <p className="text-[10px] text-[#c4c7c8]/50 font-[family-name:var(--font-jetbrains)] px-3 py-4 text-center">
                  Upload documents to begin
                </p>
              )}
            </div>
          </div>
        </nav>

        {/* Bottom actions */}
        <div className="p-8 space-y-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full border border-[#8e9192] text-white py-3 text-label tracking-[0.2em] hover:bg-white hover:text-[#141313] transition-all disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : "Upload Files"}
          </button>
          {selectedFileIds.length > 0 && (
            <button
              onClick={() => {
                setSelectedFileIds([]);
                showNotification("File scope cleared — querying all documents");
              }}
              className="w-full border border-[#444748]/30 text-[#c4c7c8] py-2 text-[10px] font-[family-name:var(--font-jetbrains)] uppercase tracking-[0.15em] hover:text-white hover:border-white/30 transition-all"
            >
              Clear Selection ({selectedFileIds.length})
            </button>
          )}
        </div>
      </aside>

      {/* ═══ MAIN CANVAS ═══ */}
      <main className="md:ml-64 xl:mr-80 min-h-screen relative">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-[#141313]/80 backdrop-blur-md w-full border-b border-[#444748]/10 flex justify-between items-center h-16 px-8">
          <div className="flex items-center gap-6">
            <div className="md:hidden font-bold text-white text-xl tracking-tighter">Cortex</div>
            {/* Scope indicator */}
            {selectedFileIds.length > 0 && (
              <div className="hidden lg:flex items-center gap-2 text-[10px] font-[family-name:var(--font-jetbrains)] uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px] text-white">filter_alt</span>
                <span className="text-[#c4c7c8]">
                  Scoped to {selectedFileIds.length} file(s)
                </span>
                <button
                  onClick={() => setSelectedFileIds([])}
                  className="text-[#c4c7c8] hover:text-white ml-1"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Search / Query Input */}
            <form onSubmit={handleSearch} className="relative group">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-transparent border-b border-[#444748]/20 focus:border-white text-[12px] py-1 px-2 w-48 lg:w-72 outline-none transition-all placeholder:opacity-30 text-white font-[family-name:var(--font-jetbrains)]"
                placeholder="ASK ABOUT YOUR DOCUMENTS..."
                type="text"
              />
              <button
                type="submit"
                disabled={!query.trim() || isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c4c7c8] group-focus-within:text-white disabled:opacity-30"
              >
                <span className="material-symbols-outlined scale-75">
                  {isLoading ? "hourglass_top" : "search"}
                </span>
              </button>
            </form>

            {/* Mobile upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="md:hidden text-[#c4c7c8] hover:text-white transition-all"
            >
              <span className="material-symbols-outlined">cloud_upload</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="p-8 lg:p-12 space-y-12">

          {/* ══ DASHBOARD VIEW ══ */}
          {activeView === "dashboard" && (
            <>
              {/* Hero */}
              <section className="max-w-4xl space-y-4 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-white" />
                  <span className="text-label tracking-[0.3em] text-[#c4c7c8]">
                    Knowledge Base Overview
                  </span>
                </div>
                <h1 className="text-headline-lg text-white">
                  Industrial Intelligence
                </h1>
                <p className="text-body-lg text-[#c4c7c8] max-w-2xl">
                  {completedDocs > 0
                    ? `${completedDocs} document${completedDocs > 1 ? "s" : ""} indexed with ${totalChunks} knowledge vectors. Query your engineering docs, maintenance logs, and SOPs using AI-powered retrieval.`
                    : "Upload engineering documents, maintenance logs, SOPs, and compliance checklists to build your industrial knowledge base."}
                </p>
              </section>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fadeIn animate-fadeIn-delay-1">
                <div className="border border-[#444748]/10 bg-[#0e0e0e] p-6">
                  <p className="text-label tracking-[0.2em] text-[#c4c7c8] mb-1">Documents</p>
                  <p className="text-[36px] text-white font-light leading-none">{completedDocs}</p>
                  <p className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] mt-2 uppercase">
                    {processingDocs > 0 ? `${processingDocs} processing` : failedDocs > 0 ? `${failedDocs} failed` : "All indexed"}
                  </p>
                </div>
                <div className="border border-[#444748]/10 bg-[#0e0e0e] p-6">
                  <p className="text-label tracking-[0.2em] text-[#c4c7c8] mb-1">Vectors</p>
                  <p className="text-[36px] text-white font-light leading-none">{totalChunks}</p>
                  <p className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] mt-2 uppercase">
                    Knowledge chunks
                  </p>
                </div>
                <div className="border border-[#444748]/10 bg-[#0e0e0e] p-6">
                  <p className="text-label tracking-[0.2em] text-[#c4c7c8] mb-1">Queries</p>
                  <p className="text-[36px] text-white font-light leading-none">{queryCount}</p>
                  <p className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] mt-2 uppercase">
                    This session
                  </p>
                </div>
                <div className="border border-[#444748]/10 bg-[#0e0e0e] p-6">
                  <p className="text-label tracking-[0.2em] text-[#c4c7c8] mb-1">Data Size</p>
                  <p className="text-[36px] text-white font-light leading-none">
                    {totalSize > 0 ? formatSize(totalSize).split(" ")[0] : "0"}
                  </p>
                  <p className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] mt-2 uppercase">
                    {totalSize > 0 ? formatSize(totalSize).split(" ")[1] : "Bytes"} ingested
                  </p>
                </div>
              </div>

              {/* Upload Dropzone */}
              <section
                className={`animate-fadeIn animate-fadeIn-delay-2 border border-dashed p-12 text-center transition-all cursor-pointer ${
                  dragActive ? "border-white bg-white/[0.02]" : "border-[#444748]/20 hover:border-[#444748]/40"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="material-symbols-outlined text-[32px] text-[#c4c7c8] mb-4 block">
                  cloud_upload
                </span>
                <p className="text-label tracking-[0.3em] text-[#c4c7c8] mb-2">
                  {isUploading ? "Uploading Files..." : "Drag & Drop Files Here"}
                </p>
                <p className="text-[11px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] mb-4">
                  PDF, CSV, TXT, MD, DOCX, JSON — Up to 100MB per file — Multiple files supported
                </p>
                <span className="border border-[#8e9192] text-white py-2 px-8 text-label tracking-[0.2em] hover:bg-white hover:text-[#141313] transition-all inline-block">
                  Browse Files
                </span>
              </section>

              {/* Document Grid */}
              {documents.length > 0 && (
                <section className="space-y-6 animate-fadeIn animate-fadeIn-delay-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-label tracking-[0.4em] text-[#c4c7c8]">
                      Indexed Documents
                    </h4>
                    {selectedFileIds.length > 0 && (
                      <span className="text-[10px] text-white font-[family-name:var(--font-jetbrains)] uppercase border border-white/20 px-3 py-1">
                        {selectedFileIds.length} Selected for Research
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        onClick={() => {
                          if (doc.status === "completed") toggleFileSelection(doc.id);
                        }}
                        className={`border px-6 py-5 transition-all cursor-pointer group relative ${
                          selectedFileIds.includes(doc.id)
                            ? "border-white bg-white/[0.03]"
                            : "border-[#444748]/10 hover:border-[#444748]/30 hover:bg-[#1c1b1b]"
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <span className="material-symbols-outlined text-[20px] text-[#c4c7c8] group-hover:text-white mt-0.5">
                            {getFileIcon(doc.doc_type)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-white font-[family-name:var(--font-jetbrains)] truncate">
                              {doc.filename}
                            </p>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] uppercase">
                                {doc.doc_type}
                              </span>
                              <span className="text-[10px] text-[#c4c7c8]/40">•</span>
                              <span className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)]">
                                {formatSize(doc.file_size)}
                              </span>
                              <span className="text-[10px] text-[#c4c7c8]/40">•</span>
                              <span className="text-[10px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)]">
                                {doc.status === "completed"
                                  ? `${doc.chunk_count} chunks`
                                  : doc.status === "failed"
                                    ? "Failed"
                                    : "Processing..."}
                              </span>
                            </div>
                          </div>
                          {/* Status / Selection indicator */}
                          {doc.status === "pending" || doc.status === "processing" ? (
                            <span className="w-2 h-2 bg-[#f59e0b] rounded-full status-pulse mt-2" />
                          ) : doc.status === "failed" ? (
                            <span className="w-2 h-2 bg-[#ff6b6b] rounded-full mt-2" />
                          ) : selectedFileIds.includes(doc.id) ? (
                            <span className="material-symbols-outlined text-[16px] text-white mt-1">check_circle</span>
                          ) : (
                            <span className="material-symbols-outlined text-[16px] text-[#c4c7c8]/30 group-hover:text-[#c4c7c8] mt-1">radio_button_unchecked</span>
                          )}
                        </div>
                        {/* Delete */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDoc(doc.id, doc.filename);
                          }}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[#c4c7c8] hover:text-white transition-all p-1"
                          title="Delete document"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#c4c7c8]/40 font-[family-name:var(--font-jetbrains)]">
                    Click documents to scope your research queries. Selected files will be used as context.
                  </p>
                </section>
              )}

              {/* Quick Queries */}
              <section className="space-y-6 animate-fadeIn animate-fadeIn-delay-3">
                <h4 className="text-label tracking-[0.4em] text-[#c4c7c8]">
                  Quick Queries
                </h4>
                <div className="flex flex-wrap gap-3">
                  {suggestedQueries.map((sq, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuery(sq);
                        inputRef.current?.focus();
                      }}
                      className="border border-[#444748]/20 px-6 py-3 text-[11px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)] text-[#c4c7c8] hover:text-white hover:border-white/30 hover:bg-[#1c1b1b] transition-all"
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ══ INTELLIGENCE VIEW ══ */}
          {activeView === "intelligence" && (
            <section className="animate-fadeIn space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-white" />
                    <span className="text-label tracking-[0.3em] text-[#c4c7c8]">
                      Intelligence Terminal
                    </span>
                  </div>
                  <h2 className="text-headline-sm text-white">Query Analysis</h2>
                  {selectedFileIds.length > 0 && (
                    <p className="text-[11px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                      Scoped to {selectedFileIds.length} file(s) —{" "}
                      <button onClick={() => setSelectedFileIds([])} className="underline hover:text-white">
                        clear
                      </button>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {messages.length > 0 && (
                    <button
                      onClick={clearChat}
                      className="border border-[#444748]/20 text-[#c4c7c8] hover:text-white hover:border-white/30 px-4 py-2 text-label tracking-[0.2em] transition-all"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => setActiveView("dashboard")}
                    className="border border-[#444748]/20 text-[#c4c7c8] hover:text-white hover:border-white/30 px-4 py-2 text-label tracking-[0.2em] transition-all"
                  >
                    Dashboard
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="space-y-6 min-h-[50vh]">
                {messages.length === 0 ? (
                  <div className="border border-[#444748]/10 bg-[#0e0e0e] p-16 text-center space-y-4">
                    <span className="material-symbols-outlined text-[48px] text-[#c4c7c8]/20">psychology</span>
                    <p className="text-label tracking-[0.3em] text-[#c4c7c8]">
                      Ready for Queries
                    </p>
                    <p className="text-[12px] text-[#c4c7c8]/60 font-[family-name:var(--font-jetbrains)] max-w-md mx-auto">
                      {completedDocs > 0
                        ? "Your documents are indexed. Ask questions about your engineering data, SOPs, maintenance logs, or compliance docs."
                        : "Upload documents first, then ask questions about them here."}
                    </p>
                    {completedDocs > 0 && (
                      <div className="flex flex-wrap justify-center gap-2 mt-4">
                        {suggestedQueries.slice(0, 3).map((sq, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setQuery(sq);
                              chatInputRef.current?.focus();
                            }}
                            className="border border-[#444748]/20 px-4 py-2 text-[10px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)] text-[#c4c7c8] hover:text-white hover:border-white/30 transition-all"
                          >
                            {sq}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[80%]">
                        {/* Header */}
                        <div className={`flex items-center gap-2 mb-1.5 ${msg.role === "user" ? "justify-end" : ""}`}>
                          {msg.role === "ai" && (
                            <span className="material-symbols-outlined text-[14px] text-white">hub</span>
                          )}
                          <span className="text-[10px] uppercase tracking-widest text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                            {msg.role === "user" ? "You" : "Cortex"}
                          </span>
                          <span className="text-[10px] text-[#c4c7c8]/50 font-[family-name:var(--font-jetbrains)]">
                            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                        {/* Body */}
                        <div
                          className={`p-6 text-[15px] leading-relaxed ${
                            msg.role === "user"
                              ? "bg-white text-[#141313]"
                              : "bg-[#0e0e0e] border border-[#444748]/10 text-[#e5e2e1]"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>

                          {/* Chart */}
                          {msg.showChart && msg.chartData && msg.chartData.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-[#444748]/10">
                              <div className="h-40 flex items-end gap-2">
                                {msg.chartData.map((d, j) => {
                                  const max = Math.max(...msg.chartData!.map((x) => x.value));
                                  return (
                                    <div key={j} className="flex-1 flex flex-col items-center gap-1">
                                      <span className="text-[9px] font-[family-name:var(--font-jetbrains)]">
                                        {d.value}
                                      </span>
                                      <div
                                        className={`w-full transition-all duration-500 ${
                                          msg.role === "user" ? "bg-[#141313]/30" : "bg-white/20"
                                        }`}
                                        style={{ height: `${max > 0 ? (d.value / max) * 100 : 0}%` }}
                                      />
                                      <span className="text-[8px] font-[family-name:var(--font-jetbrains)] uppercase truncate w-full text-center">
                                        {d.name}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Citations */}
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-[#444748]/10 flex flex-wrap items-center gap-2">
                              <span className="text-[10px] uppercase tracking-widest text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                                Sources:
                              </span>
                              {msg.citations.map((cite, j) => (
                                <span
                                  key={j}
                                  className="text-[10px] border border-[#444748]/20 px-2 py-0.5 font-[family-name:var(--font-jetbrains)] uppercase tracking-wider text-white"
                                >
                                  {cite}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* Loading */}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[#0e0e0e] border border-[#444748]/10 p-6 flex items-center gap-4">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-white typing-dot" />
                        <div className="w-2 h-2 rounded-full bg-white typing-dot" />
                        <div className="w-2 h-2 rounded-full bg-white typing-dot" />
                      </div>
                      <span className="text-[12px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
                        Analyzing documents...
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form
                onSubmit={handleSearch}
                className="sticky bottom-4 flex items-center gap-2 border border-[#444748]/20 bg-[#141313] p-2"
              >
                <span className="material-symbols-outlined text-[#c4c7c8] ml-2 scale-75">terminal</span>
                <input
                  ref={chatInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-white text-[14px] py-2 px-2 placeholder:text-[#c4c7c8]/30 font-[family-name:var(--font-jetbrains)]"
                  placeholder={
                    selectedFileIds.length > 0
                      ? `Query ${selectedFileIds.length} selected file(s)...`
                      : "Query all documents..."
                  }
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  className="border border-[#8e9192] text-white py-2 px-6 text-label tracking-[0.2em] hover:bg-white hover:text-[#141313] transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white"
                >
                  {isLoading ? "..." : "Execute"}
                </button>
              </form>
            </section>
          )}
        </div>
      </main>

      {/* ═══ RIGHT SIDEBAR ═══ */}
      <aside className="fixed right-0 top-0 h-full w-80 bg-[#141313] border-l border-[#444748]/10 z-40 hidden xl:flex flex-col">
        <div className="p-8 border-b border-[#444748]/10">
          <h4 className="text-label tracking-[0.2em] text-white mb-1">System Status</h4>
          <p className="text-[10px] text-[#c4c7c8] font-[family-name:var(--font-jetbrains)]">
            {completedDocs > 0 ? "RAG Pipeline Active" : "Awaiting Documents"}
          </p>
        </div>

        <div className="flex-1 p-8 overflow-y-auto space-y-12">
          {/* Ingestion Feed */}
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase text-[#c4c7c8] tracking-[0.2em] font-[family-name:var(--font-jetbrains)]">
                Ingestion Feed
              </span>
              <span className="text-white text-[10px] uppercase border border-white/20 px-2 py-0.5 font-[family-name:var(--font-jetbrains)]">
                {documents.length} Files
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="border-l border-[#444748]/40 p-6 opacity-50">
                <p className="text-[12px] text-[#e5e2e1] leading-relaxed">
                  No documents uploaded yet. Use the sidebar or drag files to the dashboard.
                </p>
              </div>
            ) : (
              documents.slice(0, 6).map((doc) => (
                <div
                  key={doc.id}
                  className={`border-l p-4 space-y-1 ${
                    doc.status === "completed"
                      ? "border-white bg-white/[0.02]"
                      : doc.status === "failed"
                        ? "border-[#ff6b6b] bg-[#ff6b6b]/[0.02]"
                        : "border-[#f59e0b] bg-[#f59e0b]/[0.02]"
                  }`}
                >
                  <div className="flex justify-between text-[11px] tracking-widest font-[family-name:var(--font-jetbrains)]">
                    <span className="text-white uppercase truncate max-w-[140px]">
                      {doc.filename}
                    </span>
                    <span className="text-[#c4c7c8] opacity-40">
                      {timeAgo(doc.upload_date)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#c4c7c8] leading-relaxed font-[family-name:var(--font-jetbrains)]">
                    {doc.status === "completed"
                      ? `${doc.doc_type.toUpperCase()} • ${formatSize(doc.file_size)} • ${doc.chunk_count} vectors`
                      : doc.status === "failed"
                        ? "Ingestion failed"
                        : "Processing..."}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Pipeline Status */}
          <div className="space-y-6 pt-8 border-t border-[#444748]/5">
            <span className="text-[10px] uppercase text-[#c4c7c8] tracking-[0.2em] font-[family-name:var(--font-jetbrains)]">
              Pipeline Status
            </span>
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)]">
                  <span>RAG Engine</span>
                  <span>{completedDocs > 0 ? "Active" : "Standby"}</span>
                </div>
                <div className="w-full bg-[#2a2a2a] h-0.5">
                  <div className="bg-white h-full transition-all duration-1000" style={{ width: completedDocs > 0 ? "100%" : "0%" }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)]">
                  <span>Vector Store</span>
                  <span>{totalChunks} chunks</span>
                </div>
                <div className="w-full bg-[#2a2a2a] h-0.5">
                  <div className="bg-white h-full transition-all duration-1000" style={{ width: `${Math.min((totalChunks / 200) * 100, 100)}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)]">
                  <span>Embedding</span>
                  <span>MiniLM-L6</span>
                </div>
                <div className="w-full bg-[#2a2a2a] h-0.5">
                  <div className="bg-white h-full" style={{ width: "100%" }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] uppercase tracking-widest font-[family-name:var(--font-jetbrains)]">
                  <span>LLM</span>
                  <span>Gemini 2.5</span>
                </div>
                <div className="w-full bg-[#2a2a2a] h-0.5">
                  <div className="bg-white h-full" style={{ width: "100%" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Recent Queries */}
          {messages.filter((m) => m.role === "user").length > 0 && (
            <div className="space-y-4 pt-8 border-t border-[#444748]/5">
              <span className="text-[10px] uppercase text-[#c4c7c8] tracking-[0.2em] font-[family-name:var(--font-jetbrains)]">
                Recent Queries
              </span>
              {messages
                .filter((m) => m.role === "user")
                .slice(-4)
                .reverse()
                .map((m, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(m.content);
                      setActiveView("intelligence");
                      chatInputRef.current?.focus();
                    }}
                    className="w-full text-left border-l border-[#444748]/20 pl-4 py-2 hover:border-white transition-all group"
                  >
                    <p className="text-[11px] text-[#c4c7c8] group-hover:text-white truncate font-[family-name:var(--font-jetbrains)]">
                      {m.content}
                    </p>
                    <p className="text-[9px] text-[#c4c7c8]/40 font-[family-name:var(--font-jetbrains)] mt-0.5">
                      {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#444748]/10 text-center">
          <p className="text-[9px] uppercase tracking-[0.5em] text-[#c4c7c8] opacity-40 font-[family-name:var(--font-jetbrains)]">
            Cortex v1.0 // RAG Pipeline
          </p>
        </div>
      </aside>

      {/* ═══ MOBILE BOTTOM NAV ═══ */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-[#141313] border-t border-[#444748]/10 h-16 flex items-center justify-around z-50">
        <button
          onClick={() => setActiveView("dashboard")}
          className={`flex flex-col items-center gap-1 ${activeView === "dashboard" ? "text-white" : "text-[#c4c7c8]"}`}
        >
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[8px] font-[family-name:var(--font-jetbrains)] uppercase">Dashboard</span>
        </button>
        <button
          onClick={() => setActiveView("intelligence")}
          className={`flex flex-col items-center gap-1 ${activeView === "intelligence" ? "text-white" : "text-[#c4c7c8]"}`}
        >
          <span className="material-symbols-outlined">query_stats</span>
          <span className="text-[8px] font-[family-name:var(--font-jetbrains)] uppercase">Query</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[#c4c7c8] flex flex-col items-center gap-1"
        >
          <span className="material-symbols-outlined">cloud_upload</span>
          <span className="text-[8px] font-[family-name:var(--font-jetbrains)] uppercase">Upload</span>
        </button>
      </div>
    </div>
  );
}
