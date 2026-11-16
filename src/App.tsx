/**
 * CC-Link IE TSN Class A 多機種從站模擬器與 CSP+ 規格分析控制台
 * ================================================================
 * 主要模組：
 * 1. 機種規格比較表 (Tab 1)：呈現 6 款三菱原廠 CSP+ 數位與類比模組參數
 * 2. 記憶體映射與封包監控面板 (Tab 2)：即時 I/O 控制 (RX/RY, A/D, D/A) 與近 5 筆 UDP Hex Sniffer
 * 3. 多站管理與連線評估 (Tab 3)：動態新增/修改/刪除站點、連線品質 LED、Cycle/Jitter 監測與網卡指令產生
 * 4. Python 模擬器原始碼 (Tab 4)：提供桌面視窗 GUI 版與無介面 CLI 版之檢視、複製與下載
 */

import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Layers,
  FileCode2,
  Activity,
  CheckCircle2,
  Copy,
  Check,
  Zap,
  Server,
  Radio,
  FileText,
  Network,
  Gauge,
  ChevronDown,
  ShieldCheck,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Power,
  RotateCcw,
  Terminal,
  Sliders,
  Settings2,
  Play,
  Pause,
  Send,
  Eye,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  X,
  BookOpen,
  Download,
  Laptop,
} from 'lucide-react';
import { PYTHON_GUI_SCRIPT } from './pythonGuiCode.ts';
import {
  SUPPORTED_DEVICES,
  ConfiguredStation,
  SnifferPacket,
  bitsToBytes,
  createSimulatedPacket,
  buildCliSimulatorScript,
} from './data/tsnCatalog.ts';

/** 預設載入之 3 個跨機種示範從站 */
const DEFAULT_STATIONS: ConfiguredStation[] = [
  {
    id: 'st-1',
    stationNo: 1,
    ipAddress: '192.168.3.10',
    modelId: 'NZ2GNCF1-32T',
    enabled: true,
    port: 61450,
    cycleTimeMs: 16.1,
    jitterMs: 0.3,
    quality: 'excellent',
    packetCount: 184,
    lastPacketTime: Date.now() - 16,
    historyIntervals: [16.0, 16.2, 15.9, 16.1, 16.0],
  },
  {
    id: 'st-2',
    stationNo: 2,
    ipAddress: '192.168.3.11',
    modelId: 'NZ2GN2S1-32D',
    enabled: true,
    port: 61450,
    cycleTimeMs: 16.2,
    jitterMs: 0.4,
    quality: 'excellent',
    packetCount: 182,
    lastPacketTime: Date.now() - 16,
    historyIntervals: [16.1, 16.3, 16.0, 16.2, 16.1],
  },
  {
    id: 'st-3',
    stationNo: 3,
    ipAddress: '192.168.3.12',
    modelId: 'NZ2GN2S-60AD4',
    enabled: true,
    port: 61450,
    cycleTimeMs: 15.9,
    jitterMs: 0.2,
    quality: 'excellent',
    packetCount: 180,
    lastPacketTime: Date.now() - 16,
    historyIntervals: [15.8, 16.0, 15.9, 16.0, 15.9],
  },
];

export default function App() {
  // --------------------------------------------------------------------------
  // 全域導覽與目前選取機種狀態
  // --------------------------------------------------------------------------
  const [selectedModelId, setSelectedModelId] = useState<string>('NZ2GNCF1-32T');
  const [activeTab, setActiveTab] = useState<'spec' | 'map' | 'multistation' | 'python'>('map');
  const [showGuideModal, setShowGuideModal] = useState(false);

  // 複製與檢視切換回饋狀態
  const [copiedFullCode, setCopiedFullCode] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedOsCmd, setCopiedOsCmd] = useState(false);
  const [copiedNetsh, setCopiedNetsh] = useState(false);
  const [osTab, setOsTab] = useState<'windows' | 'linux'>('windows');
  const [pythonViewMode, setPythonViewMode] = useState<'gui' | 'cli'>('gui');

  // --------------------------------------------------------------------------
  // Tab 2: 單站 I/O 調試與封包監控狀態
  // --------------------------------------------------------------------------
  const [remoteReady, setRemoteReady] = useState(true);
  const conditionSetComp = true;
  const errorCode = 0x0000;

  // 數位接點 RX (輸入) 與 RY (輸出) 32 點狀態陣列
  const [rxBits, setRxBits] = useState<boolean[]>(() => {
    const arr = new Array(32).fill(false);
    arr[0] = true;
    arr[2] = true;
    return arr;
  });
  const [ryBits, setRyBits] = useState<boolean[]>(() => {
    const arr = new Array(32).fill(false);
    arr[0] = true;
    arr[16] = true; // Y10 (供 32DT 複合模組預覽)
    return arr;
  });

  // 類比模組 4 通道數值 (-32000 ~ +32000)
  const [analogInputs, setAnalogInputs] = useState<number[]>([4000, 8000, 12000, 16000]);
  const [analogOutputs] = useState<number[]>([2000, 6000, 10000, 14000]);

  // 封包監控清單 (Packet Sniffer)
  const [packets, setPackets] = useState<SnifferPacket[]>([]);
  const [isSniffing, setIsSniffing] = useState<boolean>(true);
  const [snifferFilterStation, setSnifferFilterStation] = useState<string>('all');
  const [selectedPacket, setSelectedPacket] = useState<SnifferPacket | null>(null);
  const [packetSeqCounter, setPacketSeqCounter] = useState<number>(104);

  // --------------------------------------------------------------------------
  // Tab 3: 多站管理列表 (新增 / 修改 / 刪除 / 品質指標)
  // --------------------------------------------------------------------------
  const [stations, setStations] = useState<ConfiguredStation[]>(DEFAULT_STATIONS);
  const [activeStationId, setActiveStationId] = useState<string>('st-1');

  // 新增站點表單欄位
  const [inputStationNo, setInputStationNo] = useState<number>(4);
  const [inputIpAddress, setInputIpAddress] = useState<string>('192.168.3.13');
  const [inputModelId, setInputModelId] = useState<string>('NZ2GN2S1-32DT');
  const [formError, setFormError] = useState<string | null>(null);

  // 修改站點彈窗狀態
  const [editingStation, setEditingStation] = useState<ConfiguredStation | null>(null);
  const [editStationNo, setEditStationNo] = useState<number>(1);
  const [editIpAddress, setEditIpAddress] = useState<string>('');
  const [editModelId, setEditModelId] = useState<string>('NZ2GNCF1-32T');
  const [editPort, setEditPort] = useState<number>(61450);
  const [editEnabled, setEditEnabled] = useState<boolean>(true);
  const [editError, setEditError] = useState<string | null>(null);

  // 刪除確認彈窗目標
  const [stationToDelete, setStationToDelete] = useState<ConfiguredStation | null>(null);

  const currentDev = SUPPORTED_DEVICES.find((d) => d.id === selectedModelId) || SUPPORTED_DEVICES[0];

  // --------------------------------------------------------------------------
  // 初始化示範封包與週期性 Sniffer / Jitter 模擬排程
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (packets.length === 0 && stations.length > 0) {
      const p1 = createSimulatedPacket('RX', stations[0], 100);
      const p2 = createSimulatedPacket('TX', stations[0], 101);
      const p3 = createSimulatedPacket('RX', stations[1] || stations[0], 102);
      const p4 = createSimulatedPacket('TX', stations[1] || stations[0], 103);
      const p5 = createSimulatedPacket('RX', stations[2] || stations[0], 104);
      setPackets([p5, p4, p3, p2, p1]);
      setSelectedPacket(p5);
    }
  }, []);

  useEffect(() => {
    if (!isSniffing) return;

    const interval = setInterval(() => {
      setPacketSeqCounter((prevSeq) => {
        const nextSeq = (prevSeq + 1) & 0xffff;
        const activeList = stations.filter((s) => s.enabled);
        if (activeList.length === 0) return nextSeq;

        const targetStation = activeList[nextSeq % activeList.length];
        const isMaster = nextSeq % 2 === 0;
        const newPkt = createSimulatedPacket(isMaster ? 'RX' : 'TX', targetStation, nextSeq);

        setPackets((prev) => [newPkt, ...prev.slice(0, 19)]);

        // 更新目標站點之通訊週期 (Cycle Time) 與抖動 (Jitter)
        setStations((prevList) =>
          prevList.map((s) => {
            if (s.id !== targetStation.id || !s.enabled) return s;
            const currentInterval = Math.max(
              13,
              Math.min(20, 16.0 + Math.sin(nextSeq * 0.7) * 0.5 + (Math.random() * 0.4 - 0.2))
            );
            const prevIntervals =
              s.historyIntervals && s.historyIntervals.length > 0 ? s.historyIntervals : [16.0, 16.1, 16.0];
            const nextIntervals = [...prevIntervals.slice(-9), currentInterval];
            const avg = nextIntervals.reduce((a, b) => a + b, 0) / nextIntervals.length;
            const jitter = nextIntervals.reduce((sum, v) => sum + Math.abs(v - avg), 0) / nextIntervals.length;

            const roundedCycle = Math.round(avg * 10) / 10;
            const roundedJitter = Math.round(jitter * 10) / 10;
            let quality: ConfiguredStation['quality'] = 'excellent';
            if (roundedJitter > 1.8) quality = 'poor';
            else if (roundedJitter > 0.8) quality = 'fair';

            return {
              ...s,
              cycleTimeMs: roundedCycle,
              jitterMs: roundedJitter,
              quality,
              packetCount: s.packetCount + 1,
              lastPacketTime: Date.now(),
              historyIntervals: nextIntervals,
            };
          })
        );

        return nextSeq;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [isSniffing, stations]);

  // 手動觸發一組主從站握手封包對 (RX + TX)
  const triggerManualPacket = () => {
    const curSt = stations.find((s) => s.id === activeStationId) || stations[0];
    if (!curSt) return;

    const seq1 = packetSeqCounter + 1;
    const seq2 = packetSeqCounter + 2;
    setPacketSeqCounter(seq2);

    const rxPkt = createSimulatedPacket('RX', curSt, seq1);
    const txPkt = createSimulatedPacket('TX', curSt, seq2);

    setPackets((prev) => [txPkt, rxPkt, ...prev.slice(0, 18)]);
    setSelectedPacket(rxPkt);
  };

  // --------------------------------------------------------------------------
  // 站點 CRUD 操作函式 (新增 / 修改 / 刪除 / 啟停 / 範本載入)
  // --------------------------------------------------------------------------
  const handleAddStation = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (inputStationNo < 1 || inputStationNo > 254) {
      setFormError('站號必須介於 1 到 254 之間！');
      return;
    }
    if (stations.some((s) => s.stationNo === inputStationNo)) {
      setFormError(`站號 #${inputStationNo} 已存在於列表中，請使用未佔用之站號！`);
      return;
    }
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(inputIpAddress.trim())) {
      setFormError('請輸入合法的 IPv4 位址格式 (例如: 192.168.3.13)');
      return;
    }
    if (stations.some((s) => s.ipAddress === inputIpAddress.trim())) {
      setFormError(`IP 位址 ${inputIpAddress} 已經被其他站點使用！`);
      return;
    }

    const newStation: ConfiguredStation = {
      id: 'st-' + Date.now(),
      stationNo: inputStationNo,
      ipAddress: inputIpAddress.trim(),
      modelId: inputModelId,
      enabled: true,
      port: 61450,
      cycleTimeMs: 16.0,
      jitterMs: 0.2,
      quality: 'excellent',
      packetCount: 1,
      lastPacketTime: Date.now(),
      historyIntervals: [16.0, 16.1, 16.0],
    };

    const nextList = [...stations, newStation].sort((a, b) => a.stationNo - b.stationNo);
    setStations(nextList);

    // 自動推算下一組建議站號與 IP
    const maxNo = Math.max(...nextList.map((s) => s.stationNo), 0);
    setInputStationNo(maxNo + 1);
    const parts = inputIpAddress.trim().split('.');
    if (parts.length === 4) {
      const lastOctet = parseInt(parts[3], 10);
      if (!isNaN(lastOctet) && lastOctet < 254) {
        setInputIpAddress(`${parts[0]}.${parts[1]}.${parts[2]}.${lastOctet + 1}`);
      }
    }
  };

  const handleOpenEditModal = (st: ConfiguredStation) => {
    setEditingStation(st);
    setEditStationNo(st.stationNo);
    setEditIpAddress(st.ipAddress);
    setEditModelId(st.modelId);
    setEditPort(st.port || 61450);
    setEditEnabled(st.enabled);
    setEditError(null);
  };

  const handleSaveEditStation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStation) return;
    setEditError(null);

    if (editStationNo < 1 || editStationNo > 254) {
      setEditError('站號必須介於 1 到 254 之間！');
      return;
    }
    if (stations.some((s) => s.id !== editingStation.id && s.stationNo === editStationNo)) {
      setEditError(`站號 #${editStationNo} 已經被其他站點使用，請選用不重複站號！`);
      return;
    }
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(editIpAddress.trim())) {
      setEditError('請輸入合法的 IPv4 位址格式 (例如: 192.168.3.15)');
      return;
    }
    if (stations.some((s) => s.id !== editingStation.id && s.ipAddress === editIpAddress.trim())) {
      setEditError(`IP 位址 ${editIpAddress} 已經被其他站點使用！`);
      return;
    }

    setStations((prev) =>
      prev
        .map((s) => {
          if (s.id === editingStation.id) {
            return {
              ...s,
              stationNo: editStationNo,
              ipAddress: editIpAddress.trim(),
              modelId: editModelId,
              port: editPort,
              enabled: editEnabled,
              quality: editEnabled
                ? s.quality === 'offline'
                  ? ('excellent' as const)
                  : s.quality
                : ('offline' as const),
            };
          }
          return s;
        })
        .sort((a, b) => a.stationNo - b.stationNo)
    );
    setEditingStation(null);
  };

  const handleConfirmDelete = () => {
    if (!stationToDelete) return;
    const deletedId = stationToDelete.id;
    setStations((prev) => {
      const remaining = prev.filter((s) => s.id !== deletedId);
      if (activeStationId === deletedId && remaining.length > 0) {
        setActiveStationId(remaining[0].id);
      }
      return remaining;
    });
    setStationToDelete(null);
  };

  const handleToggleStation = (id: string) => {
    setStations((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const nextEnabled = !s.enabled;
          return {
            ...s,
            enabled: nextEnabled,
            quality: nextEnabled ? 'excellent' : 'offline',
          };
        }
        return s;
      })
    );
  };

  const handleLoadPreset = (preset: 'standard' | 'digital' | 'analog' | 'clear') => {
    if (preset === 'clear') {
      setStations([]);
      setInputStationNo(1);
      setInputIpAddress('192.168.3.10');
      return;
    }
    if (preset === 'standard') {
      setStations(DEFAULT_STATIONS);
      setInputStationNo(4);
      setInputIpAddress('192.168.3.13');
    } else if (preset === 'digital') {
      setStations([
        { id: 'st-1', stationNo: 1, ipAddress: '192.168.3.10', modelId: 'NZ2GNCF1-32T', enabled: true, port: 61450, cycleTimeMs: 16.1, jitterMs: 0.3, quality: 'excellent', packetCount: 120, lastPacketTime: Date.now(), historyIntervals: [16.0, 16.2, 16.1] },
        { id: 'st-2', stationNo: 2, ipAddress: '192.168.3.11', modelId: 'NZ2GN2S1-32T', enabled: true, port: 61450, cycleTimeMs: 16.0, jitterMs: 0.3, quality: 'excellent', packetCount: 118, lastPacketTime: Date.now(), historyIntervals: [16.0, 16.1, 15.9] },
        { id: 'st-3', stationNo: 3, ipAddress: '192.168.3.12', modelId: 'NZ2GN2S1-32D', enabled: true, port: 61450, cycleTimeMs: 16.2, jitterMs: 0.4, quality: 'excellent', packetCount: 116, lastPacketTime: Date.now(), historyIntervals: [16.1, 16.3, 16.2] },
        { id: 'st-4', stationNo: 4, ipAddress: '192.168.3.13', modelId: 'NZ2GN2S1-32DT', enabled: true, port: 61450, cycleTimeMs: 16.1, jitterMs: 0.3, quality: 'excellent', packetCount: 114, lastPacketTime: Date.now(), historyIntervals: [16.0, 16.2, 16.1] },
      ]);
      setInputStationNo(5);
      setInputIpAddress('192.168.3.14');
    } else if (preset === 'analog') {
      setStations([
        { id: 'st-1', stationNo: 1, ipAddress: '192.168.3.10', modelId: 'NZ2GN2S-60AD4', enabled: true, port: 61450, cycleTimeMs: 16.0, jitterMs: 0.2, quality: 'excellent', packetCount: 130, lastPacketTime: Date.now(), historyIntervals: [15.9, 16.0, 16.1] },
        { id: 'st-2', stationNo: 2, ipAddress: '192.168.3.11', modelId: 'NZ2GN2S-60DA4', enabled: true, port: 61450, cycleTimeMs: 16.1, jitterMs: 0.3, quality: 'excellent', packetCount: 128, lastPacketTime: Date.now(), historyIntervals: [16.1, 16.2, 16.0] },
      ]);
      setInputStationNo(3);
      setInputIpAddress('192.168.3.12');
    }
  };

  // --------------------------------------------------------------------------
  // I/O 緩衝區即時計算與動態程式碼生成
  // --------------------------------------------------------------------------
  const toggleRxBit = (idx: number) => {
    setRxBits((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const toggleRyBit = (idx: number) => {
    setRyBits((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const updateAnalogInput = (ch: number, val: number) => {
    setAnalogInputs((prev) => {
      const next = [...prev];
      next[ch] = Math.max(-32768, Math.min(32767, val));
      return next;
    });
  };

  const rxBytes = bitsToBytes(
    currentDev.readyLocation === 'RXB'
      ? rxBits.map((b, i) => {
          if (i === 11) return remoteReady;
          if (i === 10) return errorCode !== 0;
          if (i === 9) return conditionSetComp;
          return b;
        })
      : rxBits
  );
  const ryBytes = bitsToBytes(ryBits);

  // 封包監控只顯示最近 5 筆
  const filteredPackets = (
    snifferFilterStation === 'all'
      ? packets
      : packets.filter((p) => p.stationNo.toString() === snifferFilterStation)
  ).slice(0, 5);

  const activeStations = stations.filter((s) => s.enabled);

  // 動態計算整體模擬器連線品質等級
  const overallQuality = (() => {
    if (activeStations.length === 0) {
      return { label: '待機中 (無啟用站)', sub: '請啟用至少一個站點', dotClass: 'bg-slate-500', textClass: 'text-slate-400' };
    }
    if (activeStations.some((s) => s.quality === 'poor')) {
      return { label: '偵測到延遲警告', sub: '建議放寬 PLC 通訊週期', dotClass: 'bg-red-400', textClass: 'text-red-400' };
    }
    if (activeStations.some((s) => s.quality === 'fair')) {
      return { label: '輕微抖動 (Class A)', sub: '處於容許範圍內', dotClass: 'bg-amber-400', textClass: 'text-amber-300' };
    }
    return { label: '連線穩定 (Class A)', sub: '所有啟用站點間隔平滑', dotClass: 'bg-emerald-400', textClass: 'text-emerald-400' };
  })();

  const pythonSetupLines =
    activeStations.length > 0
      ? activeStations
          .map(
            (s) =>
              `    mgr.add_station(station_no=${s.stationNo}, ip_address="${s.ipAddress}", model_name="${s.modelId}")`
          )
          .join('\n')
      : '    # 目前無啟用站點，請先在管理列表新增或啟用';

  const pythonSimulatorScript = buildCliSimulatorScript(activeStations);

  const osCommandsWindows = activeStations
    .map((s) => `New-NetIPAddress -InterfaceAlias "乙太網路" -IPAddress "${s.ipAddress}" -PrefixLength 24 -SkipAsSource $False`)
    .join('\n');
  const osCommandsLinux = activeStations.map((s) => `sudo ip addr add ${s.ipAddress}/24 dev eth0`).join('\n');

  const activePythonCode = pythonViewMode === 'gui' ? PYTHON_GUI_SCRIPT : pythonSimulatorScript;
  const activeFileName = pythonViewMode === 'gui' ? 'cclink_tsn_gui_simulator.py' : 'cclink_tsn_multi_station_simulator.py';

  // --------------------------------------------------------------------------
  // 剪貼簿複製與檔案下載輔助函式
  // --------------------------------------------------------------------------
  const copyNetshCommand = () => {
    const lines = ['@echo off', 'chcp 65001 >nul', 'echo 正在為 Windows 網卡新增 CC-Link IE TSN 模擬從站 IP...'];
    stations.forEach((s) => {
      lines.push(`netsh interface ipv4 add address "乙太網路" ${s.ipAddress} 255.255.255.0`);
    });
    lines.push('echo 新增完成！請按任意鍵退出。', 'pause');
    navigator.clipboard.writeText(lines.join('\r\n'));
    setCopiedNetsh(true);
    setTimeout(() => setCopiedNetsh(false), 2500);
  };

  const copyFullCode = () => {
    navigator.clipboard.writeText(activePythonCode);
    setCopiedFullCode(true);
    setTimeout(() => setCopiedFullCode(false), 2000);
  };

  const downloadPythonFile = () => {
    const blob = new Blob([activePythonCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeFileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(pythonSetupLines);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const copyOsCmd = () => {
    const text = osTab === 'windows' ? osCommandsWindows : osCommandsLinux;
    navigator.clipboard.writeText(text);
    setCopiedOsCmd(true);
    setTimeout(() => setCopiedOsCmd(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* 頂部導覽列：標題、使用指南與調試機種切換 */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">
                CC-Link IE TSN 多機種從站模擬器與封包監控
              </h1>
              <p className="text-xs text-slate-400">
                三菱電機 CC-Link IE TSN Class A • 6 款 CSP+ 模組 • 單一 PC 多站虛擬化
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGuideModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>使用指南 & 實機連線 SOP</span>
            </button>

            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Radio className="w-3.5 h-3.5 text-blue-400" />
              調試機種:
            </span>
            <div className="relative">
              <select
                value={selectedModelId}
                onChange={(e) => {
                  setSelectedModelId(e.target.value);
                  const match = stations.find((s) => s.modelId === e.target.value);
                  if (match) setActiveStationId(match.id);
                }}
                className="bg-slate-800 border border-slate-700 text-blue-300 font-mono text-xs font-bold rounded-lg px-3 py-2 pr-8 focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
              >
                {SUPPORTED_DEVICES.map((dev) => (
                  <option key={dev.id} value={dev.id} className="bg-slate-900 text-slate-200">
                    {dev.model} ({dev.category} - {dev.pointsDesc})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>
        </div>
      </header>

      {/* 當前機種重點識別資訊條 */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-slate-200">{currentDev.name}</span>
            <span className="font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
              ModelCode: {currentDev.modelCodeHex}
            </span>
            <span className="font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/30">
              {currentDev.deviceTypeDetail}
            </span>
          </div>

          <div className="flex items-center gap-4 font-mono text-slate-300">
            <span>
              <span className="text-slate-400">Ready旗標: </span>
              <span className="text-emerald-400 font-bold">{currentDev.readyLocation}</span>
            </span>
            <span>
              <span className="text-slate-400">配置站數: </span>
              <span className="text-blue-400 font-bold">{stations.length} 站</span>
            </span>
          </div>
        </div>
      </div>

      {/* 主分頁切換列 (1 -> 2 -> 3 -> 4 順序排列) */}
      <nav className="border-b border-slate-800 bg-slate-900/40 px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('spec')}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'spec'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            1. 機種通訊規格比較表
          </button>
          <button
            onClick={() => setActiveTab('map')}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'map'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4 text-blue-400" />
            2. 記憶體映射與封包監控面板 (Sniffer)
          </button>
          <button
            onClick={() => setActiveTab('multistation')}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'multistation'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="w-4 h-4 text-emerald-400" />
            3. 單1 PC 模擬多站評估與管理列表
          </button>
          <button
            onClick={() => setActiveTab('python')}
            className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'python'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            4. Python 模擬器原始碼產生器
          </button>
        </div>
      </nav>

      {/* 主內容工作區 */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* ==================== TAB 1: 機種規格比較表 ==================== */}
        {activeTab === 'spec' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  已載入 6 款 CC-Link IE TSN CSP+ 機種完整參數對照表
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  涵蓋數位輸入 (DI)、數位輸出 (DO)、複合 I/O (DIO) 及 4 通道類比 A/D 與 D/A 模組。
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300 font-mono">
                  <thead className="bg-slate-800/80 text-slate-400 uppercase text-[11px]">
                    <tr>
                      <th className="p-3">機種型號</th>
                      <th className="p-3">類別</th>
                      <th className="p-3">Model Code</th>
                      <th className="p-3">Device Type</th>
                      <th className="p-3">點數 / 通道規模</th>
                      <th className="p-3">RX / RY</th>
                      <th className="p-3">RWr / RWw</th>
                      <th className="p-3">Ready 旗標</th>
                      <th className="p-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-[11px]">
                    {SUPPORTED_DEVICES.map((d) => {
                      const isSelected = d.id === selectedModelId;
                      return (
                        <tr
                          key={d.id}
                          className={`transition ${
                            isSelected ? 'bg-blue-600/10 border-l-4 border-l-blue-500' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="p-3 font-bold text-slate-100">{d.model}</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                d.category === 'DO'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : d.category === 'DI'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : d.category === 'DIO'
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : 'bg-amber-500/20 text-amber-400'
                              }`}
                            >
                              {d.category}
                            </span>
                          </td>
                          <td className="p-3 text-amber-300">
                            {d.modelCodeHex} <span className="text-[10px] text-slate-500">({d.modelCode})</span>
                          </td>
                          <td className="p-3 text-slate-300">0x000{d.deviceTypeId}</td>
                          <td className="p-3 text-slate-200">{d.pointsDesc}</td>
                          <td className="p-3 text-emerald-400">
                            {d.rxBitsCount}b / {d.ryBitsCount}b
                          </td>
                          <td className="p-3 text-purple-300">
                            {d.rwrWordsCount}W / {d.rwwWordsCount}W
                          </td>
                          <td className="p-3 font-semibold text-blue-300">{d.readyLocation}</td>
                          <td className="p-3">
                            <button
                              onClick={() => {
                                setSelectedModelId(d.id);
                                setActiveTab('map');
                              }}
                              className={`px-2 py-1 rounded text-[10px] transition ${
                                isSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {isSelected ? '調試中' : '選擇模擬'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 數位與類比狀態字差異重點提醒 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  數位模組 (32D / 32T / 32DT) vs 類比模組 (60AD4 / 60DA4) 差異
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  • <strong className="text-slate-100">數位 I/O 模組</strong>：Ready 旗標位於{' '}
                  <span className="text-amber-300 font-mono">RWr0.b11</span>，錯誤碼在{' '}
                  <span className="text-amber-300 font-mono">RWr1</span>。<br />
                  • <strong className="text-slate-100">類比模組</strong>：Ready 旗標位於{' '}
                  <span className="text-emerald-400 font-mono">RXB (RX bit 11)</span>，異常旗標在{' '}
                  <span className="text-emerald-400 font-mono">RXA</span>，錯誤碼在{' '}
                  <span className="text-emerald-400 font-mono">RWr0</span>。
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="font-bold text-emerald-400 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  CC-Link IE TSN Class A 非同步通訊優勢
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  6 款原廠 CSP+ 均宣告支援 <strong className="text-emerald-300">Class A</strong>。採用 Class A 運作時採用標準 UDP/IP Port 61450 非同步排程（4ms~32ms），PC 端無須特殊硬體 PTP 網卡即可直接連線模擬。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: 記憶體映射與封包監控 ==================== */}
        {activeTab === 'map' && (
          <div className="space-y-6">
            {/* 調試站點與 Ready 開關控制列 */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">目前調試站點:</span>
                    <select
                      value={activeStationId}
                      onChange={(e) => {
                        const stId = e.target.value;
                        setActiveStationId(stId);
                        const match = stations.find((s) => s.id === stId);
                        if (match) setSelectedModelId(match.modelId);
                      }}
                      className="bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-xs font-bold rounded-lg px-2.5 py-1 focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {stations.map((st) => (
                        <option key={st.id} value={st.id}>
                          站號 #{st.stationNo} ({st.ipAddress}) - {st.modelId}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    緩衝區配置: RX={currentDev.rxBitsCount}b | RY={currentDev.ryBitsCount}b | RWr=
                    {currentDev.rwrWordsCount}W | RWw={currentDev.rwwWordsCount}W
                  </p>
                </div>
              </div>

              <button
                onClick={() => setRemoteReady((r) => !r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                  remoteReady
                    ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
                    : 'bg-red-600/20 text-red-400 border-red-500/40 hover:bg-red-600/30'
                }`}
              >
                Remote Ready ({currentDev.readyLocation}): {remoteReady ? '1 (正常就緒)' : '0 (斷開/未就緒)'}
              </button>
            </div>

            {/* 即時封包監控面板 (Packet Sniffer - 最近 5 筆) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-emerald-400">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      即時封包監控面板 (Packet Sniffer — 最近 5 筆)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      擷取 UDP :61450 週期性通訊封包，顯示 Hex 原始數據、時間戳與欄位解析。
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <div className="flex items-center gap-1 font-mono text-[11px] bg-slate-950 px-2 py-1 rounded-lg border border-slate-700">
                    <Filter className="w-3 h-3 text-slate-400" />
                    <select
                      value={snifferFilterStation}
                      onChange={(e) => setSnifferFilterStation(e.target.value)}
                      className="bg-transparent text-blue-300 font-bold focus:outline-none cursor-pointer"
                    >
                      <option value="all" className="bg-slate-900 text-slate-200">全部站點</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.stationNo.toString()} className="bg-slate-900 text-slate-200">
                          站號 #{s.stationNo} ({s.ipAddress})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={triggerManualPacket}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    模擬主站發送封包
                  </button>

                  <button
                    onClick={() => setIsSniffing(!isSniffing)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition ${
                      isSniffing
                        ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    {isSniffing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {isSniffing ? '暫停' : '繼續'}
                  </button>

                  <button
                    onClick={() => setPackets([])}
                    title="清空封包"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-800/80 bg-slate-950 font-mono text-xs">
                {filteredPackets.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 font-sans">
                    目前暫無封包記錄，點擊「模擬主站發送封包」或啟用「繼續」即可接收。
                  </div>
                ) : (
                  filteredPackets.map((pkt, idx) => {
                    const isSelected = selectedPacket?.id === pkt.id;
                    const isRx = pkt.direction === 'RX';
                    return (
                      <div
                        key={pkt.id}
                        onClick={() => setSelectedPacket(pkt)}
                        className={`p-3.5 transition cursor-pointer flex flex-col gap-2 ${
                          isSelected ? 'bg-blue-950/40 border-l-4 border-l-blue-500' : 'hover:bg-slate-900/60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 font-bold">#{idx + 1}</span>
                            <span className="flex items-center gap-1 text-slate-400">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {pkt.timestamp}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold flex items-center gap-1 ${
                                isRx
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {isRx ? (
                                <>
                                  <ArrowDownLeft className="w-3 h-3" />
                                  PLC → 從站 (RX 指令)
                                </>
                              ) : (
                                <>
                                  <ArrowUpRight className="w-3 h-3" />
                                  從站 → PLC (TX 回應)
                                </>
                              )}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 font-bold">
                              站號 #{pkt.stationNo} ({pkt.model})
                            </span>
                          </div>
                          <div className="text-slate-400">
                            {pkt.srcIp}:{pkt.srcPort} → {pkt.dstIp}:{pkt.dstPort} ({pkt.lengthBytes}B)
                          </div>
                        </div>

                        <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 overflow-x-auto text-[11px] flex flex-wrap gap-1 items-center">
                          <span className="text-slate-500 select-none mr-1 text-[10px]">HEX:</span>
                          {pkt.rawHex.map((byte, bIdx) => {
                            let colorClass = 'text-violet-300';
                            if (bIdx <= 1) colorClass = 'text-cyan-400 font-bold';
                            else if (bIdx <= 5) colorClass = 'text-amber-400 font-bold';
                            else if (bIdx <= 7) colorClass = 'text-purple-400 font-bold';
                            else if (bIdx === 8) colorClass = 'text-blue-400 font-bold';
                            else if (bIdx === 9) colorClass = 'text-emerald-400 font-bold';
                            else if (bIdx <= 13) colorClass = isRx ? 'text-blue-300' : 'text-emerald-300';
                            return (
                              <span
                                key={bIdx}
                                className={`px-1 py-0.5 rounded bg-slate-950/60 border border-slate-800/80 ${colorClass}`}
                              >
                                {byte}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 選取封包欄位解析區 (Packet Dissector) */}
              {selectedPacket && (
                <div className="p-4 bg-slate-900/90 border-t border-slate-800 text-xs font-mono space-y-2">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="font-bold flex items-center gap-1.5 text-blue-400">
                      <Eye className="w-4 h-4" />
                      封包欄位解析 (Dissector) - Seq 0x{selectedPacket.seqNo.toString(16).toUpperCase()}
                    </span>
                    <span className="text-[11px] text-slate-400">{selectedPacket.timestamp}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <div className="text-slate-500">[00..01] Magic TSN</div>
                      <div className="text-cyan-400 font-bold mt-0.5">{selectedPacket.decoded.magic}</div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <div className="text-slate-500">[02..05] Model Code</div>
                      <div className="text-amber-300 font-bold mt-0.5">{selectedPacket.decoded.modelCode}</div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <div className="text-slate-500">[06..08] 序號與站號</div>
                      <div className="text-purple-300 font-bold mt-0.5">
                        Seq: {selectedPacket.seqNo} | Station: #{selectedPacket.stationNo}
                      </div>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <div className="text-slate-500">[09] 通訊狀態</div>
                      <div className="text-emerald-400 font-bold mt-0.5">{selectedPacket.decoded.statusDesc}</div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] flex flex-wrap gap-4 text-slate-300">
                    <span>
                      <span className="text-slate-500">Bit 資料: </span>
                      <strong className="text-blue-300">{selectedPacket.decoded.ryOrRxSummary}</strong>
                    </span>
                    <span>
                      <span className="text-slate-500">Word 資料: </span>
                      <strong className="text-violet-300">{selectedPacket.decoded.rwwOrRwrSummary}</strong>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 動態機種 I/O 模擬面板：依所選機種自動顯示 RX / RY / AI / AO */}
            {(currentDev.category === 'DI' || currentDev.category === 'DIO') && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono text-xs font-bold">
                      RX
                    </span>
                    <h4 className="text-sm font-bold text-slate-200">
                      數位輸入 X 訊號模擬 (從站開關 → 主站 PLC 讀取)
                    </h4>
                  </div>
                  <span className="font-mono text-xs text-slate-400">
                    HEX: {rxBytes.map((b) => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}
                  </span>
                </div>
                <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5 font-mono text-xs">
                  {rxBits.slice(0, currentDev.category === 'DIO' ? 16 : 32).map((val, idx) => (
                    <button
                      key={idx}
                      onClick={() => toggleRxBit(idx)}
                      className={`p-1.5 rounded flex flex-col items-center justify-center transition border ${
                        val
                          ? 'bg-emerald-600 border-emerald-400 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="text-[10px] opacity-75">X{idx.toString(16).toUpperCase()}</span>
                      <span className="font-bold">{val ? 'ON' : 'OFF'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(currentDev.category === 'DO' || currentDev.category === 'DIO') && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono text-xs font-bold">
                      RY
                    </span>
                    <h4 className="text-sm font-bold text-slate-200">
                      數位輸出 Y 狀態監視 (主站 PLC 驅動 → 從站接收)
                    </h4>
                  </div>
                  <span className="font-mono text-xs text-slate-400">
                    HEX: {ryBytes.map((b) => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}
                  </span>
                </div>
                <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5 font-mono text-xs">
                  {ryBits
                    .slice(currentDev.category === 'DIO' ? 16 : 0, 32)
                    .map((val, idx) => {
                      const actualIdx = currentDev.category === 'DIO' ? idx + 16 : idx;
                      return (
                        <button
                          key={actualIdx}
                          onClick={() => toggleRyBit(actualIdx)}
                          className={`p-1.5 rounded flex flex-col items-center justify-center transition border ${
                            val
                              ? 'bg-blue-600 border-blue-400 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700/50'
                          }`}
                        >
                          <span className="text-[10px] opacity-75">Y{actualIdx.toString(16).toUpperCase()}</span>
                          <span className="font-bold">{val ? '1' : '0'}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {currentDev.category === 'AI' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono text-xs font-bold">
                      A/D
                    </span>
                    <h4 className="text-sm font-bold text-slate-200">
                      4 通道類比輸入值模擬 (RWr2 ~ RWr5, -32000 ~ +32000)
                    </h4>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {[0, 1, 2, 3].map((ch) => (
                    <div key={ch} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-amber-300">CH{ch + 1} (RWr{ch + 2})</span>
                        <span className="font-mono text-xs font-semibold text-slate-200">
                          {analogInputs[ch]} LSB
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-32000"
                        max="32000"
                        step="100"
                        value={analogInputs[ch]}
                        onChange={(e) => updateAnalogInput(ch, parseInt(e.target.value, 10))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>-32000</span>
                        <span>0</span>
                        <span>+32000</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentDev.category === 'AO' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30 font-mono text-xs font-bold">
                    D/A
                  </span>
                  <h4 className="text-sm font-bold text-slate-200">
                    4 通道類比輸出監視器 (RWw2 ~ RWw5, 來自 PLC 主站)
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {[0, 1, 2, 3].map((ch) => (
                    <div key={ch} className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-purple-300">CH{ch + 1} (RWw{ch + 2})</span>
                        <Gauge className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="text-lg font-bold text-slate-100 font-mono">{analogOutputs[ch]}</div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-purple-500 h-full transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(0, ((analogOutputs[ch] + 32000) / 64000) * 100))}%`,
                          }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400">
                        約 {((analogOutputs[ch] / 16000) * 10).toFixed(2)} V
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 3: 單1 PC 多站評估與互動管理列表 ==================== */}
        {activeTab === 'multistation' && (
          <div className="space-y-6">
            {/* 精簡版多站可行性評估與 WinError 10049 快速指引 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-emerald-300">
                      單一 PC 模擬多站評估：完全可行（建議單機 16~32 站、通訊週期 16~32 ms）
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      CC-Link IE TSN Class A 採用標準 UDP Port 61450 單播協議。在 Windows 執行模擬器時，若遇{' '}
                      <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300 font-mono">WinError 10049</code>
                      （網卡尚未綁定該次要 IP），請優先使用 Python GUI 內建的{' '}
                      <strong className="text-emerald-300">0.0.0.0 萬用監聽模式</strong>（免設次要 IP），或執行右側{' '}
                      <code className="bg-slate-950 px-1 py-0.5 rounded text-blue-300 font-mono">netsh</code> 指令為網卡配發獨立 IP。
                    </p>
                  </div>
                </div>
                <button
                  onClick={copyNetshCommand}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-blue-300 flex items-center gap-1.5 transition shrink-0"
                >
                  {copiedNetsh ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedNetsh ? '已複製 netsh 批次檔' : '複製 Windows netsh 加 IP 指令'}
                </button>
              </div>
            </div>

            {/* 互動式模擬從站管理列表 */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400">
                    <Settings2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      互動式模擬站點管理列表 (Station Manager)
                    </h3>
                    <p className="text-xs text-slate-400">
                      支援動態新增、修改與刪除從站，下方即時同步 Python 多站初始化程式碼。
                    </p>
                  </div>
                </div>

                {/* 快速範本載入 */}
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <button
                    onClick={() => handleLoadPreset('standard')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                  >
                    3站示範 (DO+DI+AI)
                  </button>
                  <button
                    onClick={() => handleLoadPreset('digital')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                  >
                    全數位 4站
                  </button>
                  <button
                    onClick={() => handleLoadPreset('analog')}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                  >
                    全類比 2站
                  </button>
                  <button
                    onClick={() => handleLoadPreset('clear')}
                    className="px-2 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 transition flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    清空
                  </button>
                </div>
              </div>

              {/* 新增從站表單 */}
              <div className="p-5 border-b border-slate-800 bg-slate-950/60">
                <form onSubmit={handleAddStation} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] text-slate-400 font-mono mb-1">TSN 站號 (1~254)</label>
                      <input
                        type="number"
                        min="1"
                        max="254"
                        value={inputStationNo}
                        onChange={(e) => setInputStationNo(parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-100 focus:outline-none focus:border-blue-500"
                        required
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] text-slate-400 font-mono mb-1">綁定 IP 位址</label>
                      <input
                        type="text"
                        value={inputIpAddress}
                        onChange={(e) => setInputIpAddress(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                        placeholder="192.168.3.10"
                        required
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] text-slate-400 font-mono mb-1">模擬機種型號</label>
                      <select
                        value={inputModelId}
                        onChange={(e) => setInputModelId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {SUPPORTED_DEVICES.map((dev) => (
                          <option key={dev.id} value={dev.id}>
                            [{dev.category}] {dev.model} - {dev.pointsDesc}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 px-3 rounded-lg shadow transition"
                      >
                        <Plus className="w-4 h-4" />
                        新增站點
                      </button>
                    </div>
                  </div>
                  {formError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-800/40 px-3 py-1.5 rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}
                </form>
              </div>

              {/* 即時通訊品質摘要儀表板 (由啟用站點數據動態計算) */}
              <div className="p-4 bg-slate-900/90 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] flex items-center justify-between">
                    <span>平均通訊週期 (Cycle)</span>
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div className="text-base font-bold text-blue-400 mt-1">
                    {activeStations.length > 0
                      ? `${(activeStations.reduce((s, st) => s + st.cycleTimeMs, 0) / activeStations.length).toFixed(1)} ms`
                      : '-- ms'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">基準排程: 16.0 ms</div>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] flex items-center justify-between">
                    <span>平均網路抖動 (Jitter)</span>
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="text-base font-bold text-emerald-400 mt-1">
                    {activeStations.length > 0
                      ? `±${(activeStations.reduce((s, st) => s + st.jitterMs, 0) / activeStations.length).toFixed(1)} ms`
                      : '-- ms'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">&lt; 1.2 ms 屬穩定範圍</div>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] flex items-center justify-between">
                    <span>整體連線品質狀態</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                  </div>
                  <div className={`text-sm font-bold mt-1 flex items-center gap-1.5 ${overallQuality.textClass}`}>
                    <span className={`h-2 w-2 rounded-full ${overallQuality.dotClass}`} />
                    {overallQuality.label}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{overallQuality.sub}</div>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] flex items-center justify-between">
                    <span>啟用站點 / 累計封包</span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-base font-bold text-amber-300 mt-1">
                    {activeStations.length} 站 / {activeStations.reduce((s, st) => s + st.packetCount, 0)} Pkts
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">UDP Port 61450 Unicast</div>
                </div>
              </div>

              {/* 站點資料表格 (修正為與 thead 完全對齊的 9 欄) */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-800/60 text-slate-400 uppercase text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">運行狀態</th>
                      <th className="p-3">TSN 站號</th>
                      <th className="p-3">綁定 IP (Port 61450)</th>
                      <th className="p-3">模擬機種</th>
                      <th className="p-3">連線品質指示燈</th>
                      <th className="p-3">通訊週期 (Cycle)</th>
                      <th className="p-3">抖動值 (Jitter)</th>
                      <th className="p-3">Ready 旗標</th>
                      <th className="p-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-[11px]">
                    {stations.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-6 text-center text-slate-500 font-sans">
                          目前尚未配置任何模擬從站，請透過上方表單新增站點或載入範本。
                        </td>
                      </tr>
                    ) : (
                      stations.map((st) => {
                        const dev = SUPPORTED_DEVICES.find((d) => d.id === st.modelId) || SUPPORTED_DEVICES[0];
                        let qualityBg = 'bg-slate-800 text-slate-400 border-slate-700';
                        let qualityText = '待機 (Idle)';
                        if (st.enabled) {
                          if (st.quality === 'excellent') {
                            qualityBg = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                            qualityText = '穩定 (優良)';
                          } else if (st.quality === 'fair') {
                            qualityBg = 'bg-amber-500/10 text-amber-300 border-amber-500/30';
                            qualityText = '輕微抖動';
                          } else if (st.quality === 'poor') {
                            qualityBg = 'bg-red-500/10 text-red-400 border-red-500/30';
                            qualityText = '延遲過大';
                          }
                        }

                        return (
                          <tr
                            key={st.id}
                            className={`transition ${
                              st.enabled ? 'hover:bg-slate-800/30' : 'opacity-50 bg-slate-950/50'
                            }`}
                          >
                            <td className="p-3">
                              <button
                                onClick={() => handleToggleStation(st.id)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition ${
                                  st.enabled
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                <Power className="w-3 h-3" />
                                {st.enabled ? 'RUN' : 'STOP'}
                              </button>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 font-bold border border-blue-500/30">
                                #{st.stationNo}
                              </span>
                            </td>
                            <td className="p-3 font-bold text-slate-200">
                              {st.ipAddress}
                              <span className="text-[10px] text-slate-500 ml-1">:61450</span>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    dev.category === 'DO'
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : dev.category === 'DI'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : dev.category === 'DIO'
                                      ? 'bg-purple-500/20 text-purple-400'
                                      : 'bg-amber-500/20 text-amber-400'
                                  }`}
                                >
                                  {dev.category}
                                </span>
                                <span className="font-bold text-slate-100">{dev.model}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-bold ${qualityBg}`}>
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    st.enabled
                                      ? st.quality === 'excellent'
                                        ? 'bg-emerald-400'
                                        : st.quality === 'fair'
                                        ? 'bg-amber-400'
                                        : 'bg-red-400'
                                      : 'bg-slate-500'
                                  }`}
                                />
                                <span>{qualityText}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              {st.enabled ? (
                                <span className="font-bold text-blue-400">{st.cycleTimeMs.toFixed(1)} ms</span>
                              ) : (
                                <span className="text-slate-500">-- ms</span>
                              )}
                            </td>
                            <td className="p-3">
                              {st.enabled ? (
                                <span
                                  className={`font-semibold ${
                                    st.jitterMs <= 1.0
                                      ? 'text-emerald-400'
                                      : st.jitterMs <= 2.5
                                      ? 'text-amber-300'
                                      : 'text-red-400'
                                  }`}
                                >
                                  ±{st.jitterMs.toFixed(1)} ms
                                </span>
                              ) : (
                                <span className="text-slate-500">-- ms</span>
                              )}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  dev.readyLocation === 'RXB'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-amber-500/10 text-amber-300'
                                }`}
                              >
                                {dev.readyLocation}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => {
                                    setSelectedModelId(dev.id);
                                    setActiveStationId(st.id);
                                    setActiveTab('map');
                                  }}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[10px] flex items-center gap-1 transition"
                                >
                                  <Sliders className="w-3 h-3" />
                                  調試
                                </button>
                                <button
                                  onClick={() => handleOpenEditModal(st)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-950/60 text-amber-300 border border-slate-700 hover:border-amber-700/60 text-[10px] flex items-center gap-1 transition"
                                >
                                  <Pencil className="w-3 h-3" />
                                  修改
                                </button>
                                <button
                                  onClick={() => setStationToDelete(st)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-red-950/70 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-800 text-[10px] flex items-center gap-1 transition"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  刪除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 即時 Python 設定碼與系統網卡輔助指令 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-blue-400" />
                    <h4 className="text-sm font-bold text-slate-100">Python 模擬器即時站點配置碼</h4>
                  </div>
                  <button
                    onClick={copySnippet}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 text-xs border border-slate-700 transition"
                  >
                    {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSnippet ? '已複製！' : '複製代碼'}
                  </button>
                </div>
                <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto max-h-44 leading-relaxed">
                  <pre className="text-slate-200 whitespace-pre">{pythonSetupLines}</pre>
                </div>
                <div className="flex justify-end text-xs">
                  <button
                    onClick={() => setActiveTab('python')}
                    className="text-blue-400 hover:text-blue-300 font-semibold"
                  >
                    前往「4. Python 模擬器原始碼產生器」下載完整程式 →
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-purple-400" />
                    <h4 className="text-sm font-bold text-slate-100">PC 網卡批次綁定次要 IP 指令（選用）</h4>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setOsTab('windows')}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                        osTab === 'windows' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      PowerShell
                    </button>
                    <button
                      onClick={() => setOsTab('linux')}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                        osTab === 'linux' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Linux
                    </button>
                  </div>
                </div>
                <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 font-mono text-xs text-purple-300 overflow-x-auto max-h-44 leading-relaxed relative">
                  <button
                    onClick={copyOsCmd}
                    className="absolute right-2 top-2 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] border border-slate-700 flex items-center gap-1"
                  >
                    {copiedOsCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedOsCmd ? '已複製' : '複製'}
                  </button>
                  <pre className="whitespace-pre">{osTab === 'windows' ? osCommandsWindows : osCommandsLinux}</pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: Python 模擬器原始碼產生器 ==================== */}
        {activeTab === 'python' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileCode2 className="w-5 h-5 text-blue-400" />
                  <h3 className="text-base font-bold text-slate-100">Python 從站模擬器原始碼產生器</h3>
                </div>
                <p className="text-xs text-slate-400">
                  {pythonViewMode === 'gui'
                    ? '桌面視窗 GUI 版 (Tkinter)：免第三方套件，內建 0.0.0.0 萬用監聽、X/Y/類比控制與 Packet Sniffer。'
                    : `核心後台 CLI 版：輕量多站腳本，已同步嵌入 ${activeStations.length} 個啟用站點配置。`}
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center p-1 bg-slate-950 rounded-lg border border-slate-700 text-xs font-semibold">
                  <button
                    onClick={() => setPythonViewMode('gui')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                      pythonViewMode === 'gui' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5" />
                    桌面 GUI 版
                  </button>
                  <button
                    onClick={() => setPythonViewMode('cli')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                      pythonViewMode === 'cli' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    核心 CLI 版
                  </button>
                </div>

                <button
                  onClick={downloadPythonFile}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  下載 .py
                </button>

                <button
                  onClick={copyFullCode}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow transition"
                >
                  {copiedFullCode ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedFullCode ? '已複製！' : '複製全部代碼'}
                </button>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono text-blue-400">{activeFileName}</span>
                <span>純原生 Python 3.8+ 標準函式庫</span>
              </div>
              <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed max-h-[560px]">
                {activePythonCode}
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* ==================== 使用指南與實機連線 SOP 彈窗 ==================== */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100">CC-Link IE TSN 從站模擬器實機連線 SOP</h3>
                  <p className="text-xs text-slate-400">從網頁配置、GX Works3 設定到 Python 實機連線測試</p>
                </div>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-300 leading-relaxed">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-bold text-emerald-400 text-sm">1. 下載並啟動 Python GUI 模擬器</div>
                <p className="text-slate-400">
                  前往「4. Python 模擬器原始碼產生器」下載 <code className="text-blue-300 font-mono">cclink_tsn_gui_simulator.py</code>，於 Windows 可直接雙擊專案根目錄的 <code className="text-emerald-400 font-mono">run.bat</code> 或執行{' '}
                  <code className="text-emerald-400 font-mono">python cclink_tsn_gui_simulator.py</code>。預設已勾選「0.0.0.0 萬用監聽模式」，免設次要 IP 即可直接啟動。
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-bold text-blue-400 text-sm">2. 在 GX Works3 配置主站網路</div>
                <p className="text-slate-400">
                  匯入原廠 CSP+ 描述檔，將站點通訊模式設為 <strong className="text-amber-300">Class A</strong>、通訊週期建議設為{' '}
                  <strong className="text-amber-300">16ms ~ 32ms</strong>，從站 IP 填寫與 PC 網卡同網段之位址。
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-bold text-purple-400 text-sm">3. 驗證連線與防火牆設定</div>
                <p className="text-slate-400">
                  點擊 GUI 右上角「啟動全部從站監聽」並確認 Windows 防火牆放行 UDP Port 61450。PLC 主站 D LINK 綠燈恆亮即代表循環通訊建立成功。
                </p>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex justify-end">
              <button
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold text-xs transition"
              >
                關閉指引
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 修改從站參數彈窗 ==================== */}
      {editingStation && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">修改從站參數配置</h3>
                  <p className="text-[11px] text-slate-400">原站號 #{editingStation.stationNo}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingStation(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditStation} className="p-6 space-y-4">
              {editError && (
                <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">TSN 站號 (1~254)</label>
                  <input
                    type="number"
                    min={1}
                    max={254}
                    value={editStationNo}
                    onChange={(e) => setEditStationNo(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">綁定 IP 位址</label>
                  <input
                    type="text"
                    value={editIpAddress}
                    onChange={(e) => setEditIpAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">模擬機種型號</label>
                <select
                  value={editModelId}
                  onChange={(e) => setEditModelId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-amber-500"
                >
                  {SUPPORTED_DEVICES.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.model} - {d.name} ({d.category})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">UDP Port</label>
                  <input
                    type="number"
                    value={editPort}
                    onChange={(e) => setEditPort(parseInt(e.target.value, 10) || 61450)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">運行狀態</label>
                  <select
                    value={editEnabled ? 'true' : 'false'}
                    onChange={(e) => setEditEnabled(e.target.value === 'true')}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-amber-500"
                  >
                    <option value="true">RUN - 啟用通訊</option>
                    <option value="false">STOP - 暫停離線</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingStation(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  儲存變更
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== 刪除站點確認彈窗 ==================== */}
      {stationToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-red-800/80 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3 bg-red-950/40">
              <div className="p-2.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-sm">確認刪除模擬從站？</h3>
                <p className="text-[11px] text-red-300">站號 #{stationToDelete.stationNo} ({stationToDelete.modelId})</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono">
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">TSN 站號:</span>
                  <span className="font-bold text-blue-400">#{stationToDelete.stationNo}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">綁定 IP:</span>
                  <span>{stationToDelete.ipAddress}:61450</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">模擬機種:</span>
                  <span className="text-amber-300">{stationToDelete.modelId}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setStationToDelete(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  確認刪除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-slate-800/80 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
        CC-Link IE TSN Class A 多機種從站模擬器與 CSP+ 分析工具 • 尚未經實體 PLC 硬體實機驗證，僅供離線開發測試使用
      </footer>
    </div>
  );
}
