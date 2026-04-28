/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Target, 
  Rocket, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  Star,
  ChevronRight,
  Info,
  Save,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  AlertCircle,
  Upload,
  Share2,
  X
} from 'lucide-react';
import { 
  TRAINING_LABELS, 
  TRAINING_LOCATIONS, 
  MEMBERS, 
  StatusType,
  TYPE_LABEL,
  TYPE_CLASS,
  GoalRow,
  INITIAL_SCHEDULE_DATA,
  getDaysInMonth,
  getStartOffset
} from './constants';

// Firebase imports
import { db, auth } from './firebase';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';

// --- Types ---
interface MonthData {
  schedule: Record<string, { type: StatusType; detail: string }[]>;
  memos: Record<string, Record<number, string>>;
  dones: Record<string, Record<number, boolean>>;
  goals: Record<string, GoalRow[]>;
  nextPlan: Record<string, string>;
  teamGoal: string;
  trainingLabels?: Record<string, string>;
  trainingLocations?: Record<string, string>;
  memberStations?: Record<string, string>;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

class ErrorBoundary extends React.Component<any, any> {
  state = { hasError: false, error: null };
  constructor(props: any) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let message = "申し訳ありません。エラーが発生しました。";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          message = "アクセス権限がありません。管理者にお問い合わせください。";
        }
      } catch {
        // Not a JSON error
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-border max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Info size={32} />
            </div>
            <h2 className="text-xl font-bold text-text mb-2">エラーが発生しました</h2>
            <p className="text-text2 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent-d transition-colors"
            >
              再読み込み
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Utilities ---
const getDow = (year: number, month: number, day: number) => {
  const d = new Date(year, month, day).getDay();
  return (d + 6) % 7; // Mon=0 ... Sun=6
};

const getType = (s: string | { type: StatusType; detail: string }): StatusType => {
  if (typeof s === 'object' && s !== null) return s.type;
  if (!s || typeof s !== 'string') return 'rest';
  if (s.startsWith('研修')) return 'training';
  if (s.includes('待機')) return 'standby';
  if (s.includes('イベント')) return 'event';
  if (s === '〇') return 'normal';
  if (s === '◎') return 'request';
  if (s.includes('海浜幕張') || s.includes('鳥浜') || s.includes('外販')) return 'dispatch';
  if (s.includes('本社')) return 'office';
  if (s.includes('欠勤')) return 'absence';
  return 'other';
};

// --- Components ---

const LocalInput = ({ value, onChange, onBlur, ...props }: any) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  
  useEffect(() => { 
    if (!isFocused) setLocalValue(value); 
  }, [value, isFocused]);

  return (
    <input 
      {...props} 
      value={localValue} 
      onChange={(e) => setLocalValue(e.target.value)} 
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        if (localValue !== value) onChange(localValue);
        if (onBlur) onBlur();
      }}
    />
  );
};

const LocalTextarea = ({ value, onChange, onBlur, ...props }: any) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  
  useEffect(() => { 
    if (!isFocused) setLocalValue(value); 
  }, [value, isFocused]);

  return (
    <textarea 
      {...props} 
      value={localValue} 
      onChange={(e) => setLocalValue(e.target.value)} 
      onFocus={() => setIsFocused(true)}
      onBlur={() => {
        setIsFocused(false);
        if (localValue !== value) onChange(localValue);
        if (onBlur) onBlur();
      }}
    />
  );
};

const Legend = () => (
  <div className="bg-white rounded-xl shadow-sm p-4 border border-border mb-4">
    <div className="flex items-center gap-2 text-xs font-bold text-text mb-3">
      <div className="w-1 h-4 bg-accent rounded-full" />
      凡例 (ステータス)
    </div>
    <div className="flex flex-wrap gap-2">
      {(Object.keys(TYPE_LABEL) as StatusType[]).map(type => (
        <div key={type} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${TYPE_CLASS[type]}`}>
          {TYPE_LABEL[type]}
        </div>
      ))}
    </div>
  </div>
);

const TrainingInfo = ({ 
  title,
  labels, 
  locations, 
  onChange 
}: { 
  title: string,
  labels: Record<string, string>, 
  locations: Record<string, string>,
  onChange: (labels: Record<string, string>, locations: Record<string, string>) => void
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localLabels, setLocalLabels] = useState(labels);
  const [localLocations, setLocalLocations] = useState(locations);

  useEffect(() => {
    if (!isEditing) {
      setLocalLabels(labels);
      setLocalLocations(locations);
    }
  }, [labels, locations, isEditing]);

  const handleSave = () => {
    onChange(localLabels, localLocations);
    setIsEditing(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-border mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-bold text-text">
          <div className="w-1 h-4 bg-accent rounded-full" />
          {title}
        </div>
        <button 
          onClick={() => isEditing ? handleSave() : setIsEditing(true)}
          className="text-[10px] font-bold text-accent hover:underline flex items-center gap-1"
        >
          {isEditing ? <><Save size={12} /> 保存</> : <><Plus size={12} /> 編集</>}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.keys(TRAINING_LABELS).map((key) => (
          <div key={key} className="flex flex-col p-2 rounded-lg bg-bg border border-border">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-bold">
                {title.includes('イベント') ? key.replace('研修', 'イベント') : key}
              </span>
              {isEditing ? (
                <input 
                  className="text-xs font-bold text-text bg-white border border-border rounded px-1 w-full"
                  value={localLabels[key] || ''}
                  onChange={(e) => setLocalLabels({...localLabels, [key]: e.target.value})}
                />
              ) : (
                <span className="text-xs font-bold text-text">{labels[key] || '未設定'}</span>
              )}
            </div>
            {isEditing ? (
              <textarea 
                className="text-[10px] text-text2 leading-tight bg-white border border-border rounded px-1 w-full"
                value={localLocations[key] || ''}
                onChange={(e) => setLocalLocations({...localLocations, [key]: e.target.value})}
                rows={2}
              />
            ) : (
              <div className="text-[10px] text-text2 leading-tight">
                {locations[key] || '詳細なし'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const BulkImportModal = ({ isOpen, onClose, onImport }: { isOpen: boolean, onClose: () => void, onImport: (data: Record<string, string[]>) => void }) => {
  const [text, setText] = useState('');

  const handleImport = () => {
    if (!text.trim()) return;
    
    const lines = text.trim().split('\n');
    const result: Record<string, string[]> = {};
    
    const normalizeName = (n: string) => n.replace(/[\s　]+/g, '').trim();
    const normalizedMembers = MEMBERS.map(normalizeName);
    
    // Simple TSV/CSV parser
    // Expected format: Name \t Day1 \t Day2 ...
    lines.forEach(line => {
      const parts = line.split('\t');
      if (parts.length > 1) {
        const name = parts[0].trim();
        const normName = normalizeName(name);
        const memberIndex = normalizedMembers.indexOf(normName);
        
        if (memberIndex !== -1) {
          const schedule = parts.slice(1).map(p => p.trim());
          result[MEMBERS[memberIndex]] = schedule;
        }
      }
    });

    if (Object.keys(result).length === 0) {
      alert('有効なメンバー名が見つかりませんでした。スプレッドシートから名前を含めてコピーしてください。');
      return;
    }

    onImport(result);
    setText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-border flex items-center justify-between bg-accent text-white">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Upload size={24} />
              一括インポート
            </h2>
            <p className="text-xs opacity-80 mt-1">スプレッドシートからコピーしたデータを貼り付けてください。</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 leading-relaxed">
            <p className="font-bold mb-1">貼り付け方法:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Googleスプレッドシートを開きます。</li>
              <li>名前の列から日付の列まで、必要な範囲を選択してコピー（Ctrl+C）します。</li>
              <li>下のテキストエリアに貼り付け（Ctrl+V）ます。</li>
              <li>「インポート実行」をクリックします。</li>
            </ol>
          </div>

          <textarea 
            className="w-full h-64 border border-border rounded-xl p-4 text-xs font-mono bg-bg focus:bg-white focus:border-accent outline-none resize-none"
            placeholder="ここに貼り付けてください...&#10;例:&#10;加藤 あかり	研修1	〇	研修2...&#10;青木 大芽	〇	研修1	〇..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="p-6 border-t border-border bg-bg flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-text2 hover:bg-white transition-all"
          >
            キャンセル
          </button>
          <button 
            onClick={handleImport}
            className="px-8 py-2.5 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent-d shadow-lg shadow-accent/20 transition-all flex items-center gap-2"
          >
            <CheckCircle2 size={18} />
            インポート実行
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const MemberTabs = ({ members, current, onSelect }: { members: string[], current: string, onSelect: (n: string) => void }) => (
  <div className="bg-white rounded-xl shadow-sm mb-4 overflow-hidden border border-border">
    <div className="flex overflow-x-auto p-2 gap-1.5 border-b border-border scrollbar-hide">
      {members.map(name => (
        <button
          key={name}
          onClick={() => onSelect(name)}
          className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all duration-200 border ${
            name === current 
              ? 'bg-accent border-accent text-white font-semibold' 
              : 'bg-bg border-border2 text-text2 hover:border-accent-m hover:text-accent hover:bg-accent-l'
          }`}
        >
          {name.replace('　', '')}
        </button>
      ))}
    </div>
  </div>
);

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'goal' | 'next' | 'overall'>('schedule');
  const [currentSchedMember, setCurrentSchedMember] = useState(MEMBERS[0]);
  const [currentGoalMember, setCurrentGoalMember] = useState(MEMBERS[0]);
  const [hideDone, setHideDone] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  
  // Initialize from URL if present
  const [currentYear, setCurrentYear] = useState(() => {
    if (typeof window === 'undefined') return 2026;
    const params = new URLSearchParams(window.location.search);
    const y = params.get('year');
    const parsed = y ? parseInt(y) : NaN;
    return isNaN(parsed) ? new Date().getFullYear() : parsed;
  });
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (typeof window === 'undefined') return 3;
    const params = new URLSearchParams(window.location.search);
    const m = params.get('month');
    const parsed = m ? parseInt(m) - 1 : NaN;
    if (isNaN(parsed)) return new Date().getMonth();
    return Math.max(0, Math.min(11, parsed));
  });

  // Data States
  const [allData, setAllData] = useState<Record<string, MonthData>>({});
  const [globalStations, setGlobalStations] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSaveOk, setShowSaveOk] = useState<Record<string, boolean>>({});

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    }
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    
    let userMessage = "データベースとの通信中にエラーが発生しました。";
    if (errInfo.error.includes("insufficient permissions")) {
      userMessage = "アクセス権限がありません。URLが正しいか、管理者にお問い合わせください。";
    } else if (errInfo.error.includes("offline")) {
      userMessage = "オフラインのようです。インターネット接続を確認してください。";
    }
    
    setError(userMessage);
    setIsLoading(false);
    setIsSaving(false);
  };

  const monthKey = `${currentYear}-${currentMonth + 1}`;

  // URL Sync (Update URL when state changes)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('year', currentYear.toString());
    url.searchParams.set('month', (currentMonth + 1).toString());
    window.history.replaceState({}, '', url.toString());
  }, [currentYear, currentMonth]);

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  // Current Month Data
  const currentMonthData = useMemo(() => {
    const data = allData[monthKey];
    const isApril2026 = currentYear === 2026 && currentMonth === 3;
    const isAfterApril2026 = currentYear > 2026 || (currentYear === 2026 && currentMonth > 3);

    const migratedSched: Record<string, { type: StatusType, detail: string }[]> = {};
    
    if (data) {
      // Name migration for existing Firestore data
      const OLD_NAME = '岸田　音楓';
      const NEW_NAME = '深瀬　音楓';

      // Migrate schedule if needed
      for (const member of MEMBERS) {
        let s = data.schedule?.[member];
        
        // If data exists under old name but not new name, use old name's data
        if (!s && member === NEW_NAME && data.schedule?.[OLD_NAME]) {
          s = data.schedule[OLD_NAME];
        }

        const daysInMonth = getDaysInMonth(currentYear, currentMonth);
        
        if (Array.isArray(s) && s.length > 0) {
          migratedSched[member] = s.map((item: any) => {
            if (typeof item === 'object' && item !== null) {
              if ('type' in item) return item as { type: StatusType, detail: string };
              const detail = item.detail || item.status || '';
              return { type: getType(detail), detail: String(detail) };
            }
            return { type: getType(item), detail: String(item || '') };
          });
          
          // Ensure correct length
          if (migratedSched[member].length < daysInMonth) {
            const extra = Array(daysInMonth - migratedSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
            migratedSched[member] = [...migratedSched[member], ...extra];
          } else if (migratedSched[member].length > daysInMonth) {
            migratedSched[member] = migratedSched[member].slice(0, daysInMonth);
          }
        } else {
          // Fallback to initial data for April 2026 if missing or empty
          if (isApril2026 && INITIAL_SCHEDULE_DATA[member]) {
            const initial = INITIAL_SCHEDULE_DATA[member];
            migratedSched[member] = initial.map(s => ({ type: getType(s), detail: s }));
            
            // Ensure correct length for initial data too
            if (migratedSched[member].length < daysInMonth) {
              const extra = Array(daysInMonth - migratedSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
              migratedSched[member] = [...migratedSched[member], ...extra];
            } else if (migratedSched[member].length > daysInMonth) {
              migratedSched[member] = migratedSched[member].slice(0, daysInMonth);
            }
          } else {
            migratedSched[member] = Array(daysInMonth).fill(null).map(() => ({ type: 'rest', detail: '' }));
          }
        }
      }

      // If it's May onwards and the data was accidentally initialized with April data,
      // we might want to clear it, but for now we just respect what's in Firestore.
      // However, if the user explicitly wants "blank", they can clear it.
      
      // Migrate other fields
      const migratedMemos = { ...data.memos };
      const migratedDones = { ...data.dones };
      const migratedGoals = { ...data.goals };
      const migratedNextPlan = { ...data.nextPlan };
      const migratedStations = { ...data.memberStations };

      if (migratedMemos[OLD_NAME] && !migratedMemos[NEW_NAME]) migratedMemos[NEW_NAME] = migratedMemos[OLD_NAME];
      if (migratedDones[OLD_NAME] && !migratedDones[NEW_NAME]) migratedDones[NEW_NAME] = migratedDones[OLD_NAME];
      if (migratedGoals[OLD_NAME] && !migratedGoals[NEW_NAME]) migratedGoals[NEW_NAME] = migratedGoals[OLD_NAME];
      if (migratedNextPlan[OLD_NAME] && !migratedNextPlan[NEW_NAME]) migratedNextPlan[NEW_NAME] = migratedNextPlan[OLD_NAME];
      if (migratedStations[OLD_NAME] && !migratedStations[NEW_NAME]) migratedStations[NEW_NAME] = migratedStations[OLD_NAME];

      return {
        ...data,
        schedule: migratedSched,
        memos: migratedMemos,
        dones: migratedDones,
        goals: migratedGoals,
        nextPlan: migratedNextPlan,
        teamGoal: data.teamGoal || '',
        trainingLabels: data.trainingLabels || (isAfterApril2026 ? {} : TRAINING_LABELS),
        trainingLocations: data.trainingLocations || (isAfterApril2026 ? {} : TRAINING_LOCATIONS),
        memberStations: migratedStations,
      } as MonthData;
    }
    
    // Default data (when no data in Firestore)
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    for (const member of MEMBERS) {
      if (isApril2026) {
        const initial = INITIAL_SCHEDULE_DATA[member] || [];
        migratedSched[member] = initial.map(s => ({ type: getType(s), detail: s }));
        
        // Ensure correct length
        if (migratedSched[member].length < daysInMonth) {
          const extra = Array(daysInMonth - migratedSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
          migratedSched[member] = [...migratedSched[member], ...extra];
        } else if (migratedSched[member].length > daysInMonth) {
          migratedSched[member] = migratedSched[member].slice(0, daysInMonth);
        }
      } else {
        // For other months (especially 5月以降), start with blank
        migratedSched[member] = Array(daysInMonth).fill(null).map(() => ({ type: 'rest', detail: '' }));
      }
    }

    return {
      schedule: migratedSched,
      memos: {},
      dones: {},
      goals: {},
      nextPlan: {},
      teamGoal: '',
      trainingLabels: isAfterApril2026 ? {} : TRAINING_LABELS,
      trainingLocations: isAfterApril2026 ? {} : TRAINING_LOCATIONS,
      memberStations: {},
    } as MonthData;
  }, [allData, monthKey, currentMonth, currentYear]);

  // Load data from Firestore
  useEffect(() => {
    setIsLoading(true);
    const path = 'months';
    const unsubscribe = onSnapshot(doc(db, path, monthKey), (snapshot) => {
      if (snapshot.exists()) {
        setAllData(prev => ({
          ...prev,
          [monthKey]: snapshot.data() as MonthData
        }));
      }
      setIsLoading(false);
      setError(null);
    }, (err) => {
      console.error('Firestore Error:', err);
      setError(err.message);
      handleFirestoreError(err, OperationType.GET, `${path}/${monthKey}`);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [monthKey]);

  // Load global settings (stations)
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.memberStations) {
          setGlobalStations(data.memberStations);
        }
      }
    }, (err) => {
      console.error('Global Settings Error:', err);
    });

    return () => unsubscribe();
  }, []);

  const saveData = async (updates: Record<string, any>) => {
    setIsSaving(true);
    const path = `months/${monthKey}`;
    try {
      const docRef = doc(db, 'months', monthKey);
      // Use updateDoc for better merging of nested fields if keys contain dots
      // or setDoc with merge if it's a flat update
      const hasDots = Object.keys(updates).some(k => k.includes('.'));
      if (hasDots) {
        await updateDoc(docRef, {
          ...updates,
          updatedAt: serverTimestamp()
        });
      } else {
        await setDoc(docRef, {
          ...updates,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      console.log('Saved successfully:', updates);
    } catch (e: any) {
      // If document doesn't exist, updateDoc fails. Fallback to setDoc.
      if (e.code === 'not-found') {
        try {
          const docRef = doc(db, 'months', monthKey);
          await setDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
          }, { merge: true });
        } catch (e2) {
          handleFirestoreError(e2, OperationType.WRITE, path);
        }
      } else {
        handleFirestoreError(e, OperationType.WRITE, path);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const triggerSaveOk = (id: string) => {
    setShowSaveOk(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setShowSaveOk(prev => ({ ...prev, [id]: false }));
    }, 2000);
  };

  // --- Handlers ---
  const updateCurrentMonthData = (updates: Partial<MonthData>) => {
    saveData(updates);
  };

  const handleScheduleTypeChange = (member: string, dayIdx: number, type: StatusType) => {
    const memberSched = [...(currentMonthData.schedule[member] || Array(31).fill({ type: 'rest', detail: '' }))];
    memberSched[dayIdx] = { ...memberSched[dayIdx], type };
    saveData({ [`schedule.${member}`]: memberSched });
  };

  const handleScheduleDetailChange = (member: string, dayIdx: number, detail: string) => {
    const memberSched = [...(currentMonthData.schedule[member] || Array(31).fill({ type: 'rest', detail: '' }))];
    memberSched[dayIdx] = { ...memberSched[dayIdx], detail };
    saveData({ [`schedule.${member}`]: memberSched });
  };

  const handleResetMonth = () => {
    if (!window.confirm(`${currentYear}年${currentMonth + 1}月のスケジュールを全て空欄にリセットしますか？`)) return;
    const blankSched: Record<string, { type: StatusType, detail: string }[]> = {};
    for (const member of MEMBERS) {
      blankSched[member] = Array(31).fill(null).map(() => ({ type: 'rest', detail: '' }));
    }
    updateCurrentMonthData({ 
      schedule: blankSched,
      trainingLabels: {},
      trainingLocations: {}
    });
  };

  const handleRestoreInitial = () => {
    if (currentYear !== 2026 || currentMonth !== 3) return;
    if (!window.confirm("4月のスケジュールを初期データに復元しますか？（現在の入力内容は上書きされます）")) return;
    
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const newSched: Record<string, { type: StatusType, detail: string }[]> = {};
    for (const member of MEMBERS) {
      const initial = INITIAL_SCHEDULE_DATA[member] || [];
      newSched[member] = initial.map(s => ({ type: getType(s), detail: s }));
      
      // Ensure correct length
      if (newSched[member].length < daysInMonth) {
        const extra = Array(daysInMonth - newSched[member].length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
        newSched[member] = [...newSched[member], ...extra];
      } else if (newSched[member].length > daysInMonth) {
        newSched[member] = newSched[member].slice(0, daysInMonth);
      }
    }
    updateCurrentMonthData({ 
      schedule: newSched,
      trainingLabels: TRAINING_LABELS,
      trainingLocations: TRAINING_LOCATIONS
    });
  };

  const handleBulkImport = (importedData: Record<string, string[]>) => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const newSched = { ...currentMonthData.schedule };
    
    Object.keys(importedData).forEach(member => {
      const rawData = importedData[member];
      const processed = rawData.map(s => ({ type: getType(s), detail: s }));
      
      // Ensure correct length
      if (processed.length < daysInMonth) {
        const extra = Array(daysInMonth - processed.length).fill(null).map(() => ({ type: 'rest' as StatusType, detail: '' }));
        newSched[member] = [...processed, ...extra];
      } else {
        newSched[member] = processed.slice(0, daysInMonth);
      }
    });

    updateCurrentMonthData({ schedule: newSched });
    triggerSaveOk('bulk-import');
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    triggerSaveOk('share');
  };

  const handleMemoChange = (member: string, day: number, val: string) => {
    const newMemos = { ...currentMonthData.memos };
    newMemos[member] = { ...(newMemos[member] || {}), [day]: val };
    updateCurrentMonthData({ memos: newMemos });
  };

  const handleDoneChange = (member: string, day: number, checked: boolean) => {
    const newDones = { ...currentMonthData.dones };
    newDones[member] = { ...(newDones[member] || {}), [day]: checked };
    updateCurrentMonthData({ dones: newDones });
  };

  const handleTeamGoalSave = () => {
    updateCurrentMonthData({ teamGoal: currentMonthData.teamGoal });
    triggerSaveOk('team-goal');
  };

  const handleIndividualGoalChange = (member: string, index: number, field: keyof GoalRow, val: any) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals[index] = { ...memberGoals[index], [field]: val };
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const addGoalRow = (member: string) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals.push({ content: '', person: '', deadline: '', stars: 0, note: '' });
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const deleteGoalRow = (member: string, index: number) => {
    const newGoals = { ...currentMonthData.goals };
    const memberGoals = [...(newGoals[member] || [])];
    memberGoals.splice(index, 1);
    newGoals[member] = memberGoals;
    updateCurrentMonthData({ goals: newGoals });
  };

  const handleGoalSave = (member: string) => {
    // Already auto-saving, but can show feedback
    triggerSaveOk('goal');
  };

  const handleNextPlanChange = (member: string, val: string) => {
    const newNextPlan = { ...currentMonthData.nextPlan, [member]: val };
    updateCurrentMonthData({ nextPlan: newNextPlan });
  };

  const handleNextPlanSave = () => {
    updateCurrentMonthData({ nextPlan: currentMonthData.nextPlan });
    triggerSaveOk('next');
  };

  const handleMemberStationChange = async (member: string, val: string) => {
    const newStations = { ...globalStations, [member]: val };
    setGlobalStations(newStations); // Optimistic update
    
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        memberStations: newStations,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('Failed to save global station:', err);
    }
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startOffset = getStartOffset(currentYear, currentMonth);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-text2 font-bold animate-pulse">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-text mb-2">エラーが発生しました</h2>
          <p className="text-text2 text-sm mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent-d transition-all"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
              <Calendar size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">EX事業部</h1>
              <p className="text-[10px] text-text2 font-medium uppercase tracking-widest">Schedule Management</p>
            </div>
          </div>

          {/* Month Selector */}
          <div className="flex items-center gap-2 bg-bg rounded-lg p-1 border border-border">
            <button 
              onClick={() => setCurrentMonth(prev => (prev === 0 ? 11 : prev - 1))}
              className="p-1.5 hover:bg-white rounded-md transition-colors text-text2 hover:text-accent"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-mono text-sm font-bold px-3 min-w-[100px] text-center">
              {currentYear}.{String(currentMonth + 1).padStart(2, '0')}
            </span>
            <button 
              onClick={() => setCurrentMonth(prev => (prev === 11 ? 0 : prev + 1))}
              className="p-1.5 hover:bg-white rounded-md transition-colors text-text2 hover:text-accent"
            >
              <ChevronRightIcon size={18} />
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            {isSaving && (
              <div className="flex items-center gap-1.5 text-[10px] text-accent font-bold animate-pulse">
                <Save size={12} />
                保存中...
              </div>
            )}
            <button 
              onClick={handleShare}
              className="p-2 text-text2 hover:text-accent hover:bg-accent/5 rounded-lg transition-colors relative"
              title="URLをコピー"
            >
              <Share2 size={20} />
              {showSaveOk['share'] && (
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                  コピーしました
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 text-[10px] font-bold">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              パブリック編集モード
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-border px-4 flex overflow-x-auto shadow-sm sticky top-16 z-40 scrollbar-hide">
        <div className="max-w-7xl mx-auto w-full flex">
          {[
            { id: 'schedule', label: 'スケジュール', icon: Calendar },
            { id: 'overall', label: '全体表示', icon: Info },
            { id: 'goal', label: '目標管理', icon: Target },
            { id: 'next', label: 'ネクストプラン', icon: Rocket },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'text-accent border-accent font-bold bg-accent/5' 
                  : 'text-text2 border-transparent hover:text-accent hover:bg-bg'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="p-4 md:p-6 max-w-7xl mx-auto w-full flex-grow">
        <AnimatePresence mode="wait">
          {activeTab === 'schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <MemberTabs 
                members={MEMBERS} 
                current={currentSchedMember} 
                onSelect={setCurrentSchedMember} 
              />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1">
                  <Legend />
                </div>
                <div className="lg:col-span-2">
                  <TrainingInfo 
                    title={currentMonth >= 4 ? "イベントの詳細" : "研修の詳細"}
                    labels={currentMonthData.trainingLabels || {}} 
                    locations={currentMonthData.trainingLocations || {}}
                    onChange={(labels, locations) => updateCurrentMonthData({ trainingLabels: labels, trainingLocations: locations })}
                  />
                </div>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm p-4 md:p-5 border border-border overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-text">{currentYear}年{currentMonth + 1}月</span>
                    <button 
                      onClick={() => setHideDone(!hideDone)}
                      className={`px-3 py-1 rounded-md text-xs transition-all border ${
                        hideDone 
                          ? 'bg-accent border-accent text-white' 
                          : 'bg-bg border-border2 text-text2'
                      }`}
                    >
                      完了済みを非表示
                    </button>
                    <button 
                      onClick={() => setIsImportOpen(true)}
                      className="px-3 py-1 rounded-md text-xs transition-all border bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 flex items-center gap-1"
                    >
                      <Upload size={12} />
                      一括インポート
                    </button>
                    <button 
                      onClick={handleResetMonth}
                      className="px-3 py-1 rounded-md text-xs transition-all border bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                    >
                      この月をリセット
                    </button>
                    {currentYear === 2026 && currentMonth === 3 && (
                      <button 
                        onClick={handleRestoreInitial}
                        className="px-3 py-1 rounded-md text-xs transition-all border bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100"
                      >
                        初期データに復元
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-text3 flex items-center gap-1">
                    <ChevronRight size={12} className="animate-pulse" />
                    横スクロールで全体表示
                  </div>
                </div>

                {/* Scrollable Calendar Container */}
                <div className="overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
                  <div className="min-w-[700px]">
                    {/* Calendar Grid Header */}
                    <div className="grid grid-cols-7 gap-1 md:gap-2 mb-1">
                      {['月', '火', '水', '木', '金', '土', '日'].map((day, i) => (
                        <div key={day} className={`text-center text-[11px] font-bold py-1 font-mono ${
                          i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-text2'
                        }`}>
                          {day}
                        </div>
                      ))}
                    </div>

                    {/* Calendar Grid Body */}
                    <div className="grid grid-cols-7 gap-1 md:gap-2">
                      {/* Offset cells */}
                      {Array.from({ length: startOffset }).map((_, i) => (
                        <div key={`offset-${i}`} className="min-h-[100px] md:min-h-[130px]" />
                      ))}

                      {/* Day cells */}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const dow = getDow(currentYear, currentMonth, day);
                        const item = currentMonthData.schedule[currentSchedMember]?.[i] || { type: 'rest', detail: '' };
                        const type = item.type;
                        const detail = item.detail;
                        const isDone = currentMonthData.dones[currentSchedMember]?.[day] || false;
                        const isSat = dow === 5;
                        const isSun = dow === 6;

                        if (isDone && hideDone) return null;

                        return (
                          <div 
                            key={day}
                            className={`border border-border rounded-lg p-1.5 md:p-2 min-h-[100px] md:min-h-[130px] transition-all relative flex flex-col ${
                              isDone ? 'opacity-50' : 'bg-white'
                            } ${isSun ? 'bg-red-50/30' : isSat ? 'bg-blue-50/30' : ''}`}
                          >
                            <span className={`font-mono text-xs font-bold mb-1 ${
                              isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-accent'
                            }`}>
                              {day}
                            </span>
                            
                            <div className="flex flex-col gap-1 mb-1">
                              <select
                                className={`w-full px-1 py-0.5 rounded-full text-[9px] md:text-[10px] font-bold outline-none border border-transparent focus:border-accent/30 transition-all ${TYPE_CLASS[type]}`}
                                value={type}
                                onChange={(e) => handleScheduleTypeChange(currentSchedMember, i, e.target.value as StatusType)}
                              >
                                {Object.keys(TYPE_LABEL).map(t => (
                                  <option key={t} value={t}>{TYPE_LABEL[t as StatusType]}</option>
                                ))}
                              </select>
                              {(type !== 'normal' && type !== 'request' && type !== 'rest') && (
                                <LocalInput
                                  className="w-full px-1.5 py-0.5 rounded border border-border text-[9px] md:text-[10px] outline-none focus:border-accent"
                                  value={detail}
                                  onChange={(val: string) => handleScheduleDetailChange(currentSchedMember, i, val)}
                                  placeholder="詳細..."
                                  list="status-suggestions"
                                />
                              )}
                            </div>

                            <LocalTextarea
                              className="w-full border border-border rounded p-1 text-[9px] md:text-[10px] bg-bg focus:bg-white focus:border-accent outline-none resize-none flex-grow mt-1"
                              rows={2}
                              placeholder="メモ..."
                              value={currentMonthData.memos[currentSchedMember]?.[day] || ''}
                              onChange={(val: string) => handleMemoChange(currentSchedMember, day, val)}
                            />

                            <div className="flex items-center gap-1 mt-1 text-[9px] md:text-[10px] text-text2">
                              <input 
                                type="checkbox" 
                                id={`chk-${day}`}
                                className="accent-accent w-3 h-3"
                                checked={isDone}
                                onChange={(e) => handleDoneChange(currentSchedMember, day, e.target.checked)}
                              />
                              <label htmlFor={`chk-${day}`}>完了</label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <datalist id="status-suggestions">
                      {Object.keys(currentMonthData.trainingLabels || {}).map(k => (
                        <option key={k} value={k}>{currentMonthData.trainingLabels?.[k]}</option>
                      ))}
                      <option value="待機(海浜幕張)" />
                      <option value="待機(鳥浜)" />
                      <option value="海浜幕張" />
                      <option value="鳥浜" />
                      <option value="外販ミステリー1" />
                      <option value="イベントメンバー選抜" />
                      <option value="VR" />
                      <option value="販売" />
                    </datalist>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'goal' && (
            <motion.div
              key="goal"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Team Goal */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                <div className="flex items-center gap-2 text-sm font-bold text-text mb-3">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  {currentMonth + 1}月の全体目標
                </div>
                <p className="text-xs text-text2 mb-4">チーム全体で達成を目指す今月の目標を記入してください。</p>
                <LocalTextarea
                  className="w-full border border-border2 rounded-lg p-3 text-sm bg-bg focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/10 outline-none min-h-[120px] transition-all leading-relaxed"
                  placeholder="例：研修全9項目の修了率100%達成、イベントメンバー全員参加、外販ミステリー全員実施..."
                  value={currentMonthData.teamGoal}
                  onChange={(val: string) => updateCurrentMonthData({ teamGoal: val })}
                />
                <div className="flex items-center gap-3 mt-3">
                  <button 
                    onClick={handleTeamGoalSave}
                    className="bg-accent hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center gap-2"
                  >
                    <Save size={16} />
                    保存する
                  </button>
                  {showSaveOk['team-goal'] && (
                    <span className="text-xs text-green-600 font-medium animate-in fade-in slide-in-from-left-2">✓ 保存しました</span>
                  )}
                </div>
              </div>

              {/* Individual Goals */}
              <div className="space-y-4">
                <MemberTabs 
                  members={MEMBERS} 
                  current={currentGoalMember} 
                  onSelect={setCurrentGoalMember} 
                />
                
                <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                  <div className="flex items-center gap-2 text-sm font-bold text-text mb-4">
                    <div className="w-1 h-4 bg-accent rounded-full" />
                    個人目標管理
                  </div>

                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-accent-l text-accent">
                          <th className="p-2 text-left border border-border font-bold w-[30%]">目標内容</th>
                          <th className="p-2 text-left border border-border font-bold w-[12%]">担当者</th>
                          <th className="p-2 text-left border border-border font-bold w-[13%]">期限</th>
                          <th className="p-2 text-left border border-border font-bold w-[15%]">達成度</th>
                          <th className="p-2 text-left border border-border font-bold w-[22%]">備考</th>
                          <th className="p-2 text-center border border-border font-bold w-[8%]">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(currentMonthData.goals[currentGoalMember]) ? currentMonthData.goals[currentGoalMember] : []).map((row, idx) => (
                          <tr key={idx} className={idx % 2 === 1 ? 'bg-bg/50' : ''}>
                            <td className="p-1.5 border border-border">
                              <LocalInput 
                                type="text" 
                                className="w-full p-2 rounded border border-border bg-bg focus:bg-white focus:border-accent outline-none text-sm"
                                value={row.content}
                                onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'content', val)}
                                placeholder="目標内容を入力"
                              />
                            </td>
                            <td className="p-1.5 border border-border">
                              <LocalInput 
                                type="text" 
                                className="w-full p-2 rounded border border-border bg-bg focus:bg-white focus:border-accent outline-none text-sm"
                                value={row.person}
                                onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'person', val)}
                                placeholder="担当者"
                              />
                            </td>
                            <td className="p-1.5 border border-border">
                              <input 
                                type="date" 
                                className="w-full p-2 rounded border border-border bg-bg focus:bg-white focus:border-accent outline-none text-sm"
                                value={row.deadline}
                                onChange={(e) => handleIndividualGoalChange(currentGoalMember, idx, 'deadline', e.target.value)}
                              />
                            </td>
                            <td className="p-1.5 border border-border">
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map(star => (
                                  <button
                                    key={star}
                                    onClick={() => handleIndividualGoalChange(currentGoalMember, idx, 'stars', star)}
                                    className={`transition-colors ${row.stars >= star ? 'text-amber-500' : 'text-gray-300'}`}
                                  >
                                    <Star size={16} fill={row.stars >= star ? 'currentColor' : 'none'} />
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td className="p-1.5 border border-border">
                              <LocalInput 
                                type="text" 
                                className="w-full p-2 rounded border border-border bg-bg focus:bg-white focus:border-accent outline-none text-sm"
                                value={row.note}
                                onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'note', val)}
                                placeholder="備考"
                              />
                            </td>
                            <td className="p-1.5 border border-border text-center">
                              <button 
                                onClick={() => deleteGoalRow(currentGoalMember, idx)}
                                className="text-red-500 hover:bg-red-50 p-2 rounded transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card Layout */}
                  <div className="lg:hidden space-y-4">
                    {(Array.isArray(currentMonthData.goals[currentGoalMember]) ? currentMonthData.goals[currentGoalMember] : []).map((row, idx) => (
                      <div key={idx} className="p-4 rounded-xl border border-border bg-bg/30 space-y-3 relative">
                        <button 
                          onClick={() => deleteGoalRow(currentGoalMember, idx)}
                          className="absolute top-3 right-3 text-red-500 p-2 hover:bg-red-50 rounded-full transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>

                        <div>
                          <label className="block text-[10px] font-bold text-text2 mb-1 uppercase tracking-wider">目標内容</label>
                          <LocalInput 
                            type="text" 
                            className="w-full p-3 rounded-lg border border-border bg-white focus:border-accent outline-none text-sm font-medium shadow-sm"
                            value={row.content}
                            onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'content', val)}
                            placeholder="目標内容を入力"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-text2 mb-1 uppercase tracking-wider">担当者</label>
                            <LocalInput 
                              type="text" 
                              className="w-full p-3 rounded-lg border border-border bg-white focus:border-accent outline-none text-sm font-medium shadow-sm"
                              value={row.person}
                              onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'person', val)}
                              placeholder="担当者"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-text2 mb-1 uppercase tracking-wider">期限</label>
                            <input 
                              type="date" 
                              className="w-full p-3 rounded-lg border border-border bg-white focus:border-accent outline-none text-sm font-medium shadow-sm"
                              value={row.deadline}
                              onChange={(e) => handleIndividualGoalChange(currentGoalMember, idx, 'deadline', e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div>
                            <label className="block text-[10px] font-bold text-text2 mb-1 uppercase tracking-wider">達成度</label>
                            <div className="flex gap-1.5">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button
                                  key={star}
                                  onClick={() => handleIndividualGoalChange(currentGoalMember, idx, 'stars', star)}
                                  className={`transition-colors ${row.stars >= star ? 'text-amber-500' : 'text-gray-300'}`}
                                >
                                  <Star size={22} fill={row.stars >= star ? 'currentColor' : 'none'} />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-text2 mb-1 uppercase tracking-wider">備考</label>
                          <LocalInput 
                            type="text" 
                            className="w-full p-3 rounded-lg border border-border bg-white focus:border-accent outline-none text-sm font-medium shadow-sm"
                            value={row.note}
                            onChange={(val: string) => handleIndividualGoalChange(currentGoalMember, idx, 'note', val)}
                            placeholder="備考"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <button 
                    onClick={() => addGoalRow(currentGoalMember)}
                    className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-accent-m bg-accent-l text-accent text-xs font-bold hover:bg-accent hover:text-white hover:border-accent transition-all"
                  >
                    <Plus size={14} />
                    行を追加
                  </button>

                  <div className="flex items-center gap-3 mt-5">
                    <button 
                      onClick={() => handleGoalSave(currentGoalMember)}
                      className="bg-accent hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center gap-2"
                    >
                      <Save size={16} />
                      保存する
                    </button>
                    {showSaveOk['goal'] && (
                      <span className="text-xs text-green-600 font-medium animate-in fade-in slide-in-from-left-2">✓ 保存しました</span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'next' && (
            <motion.div
              key="next"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                <div className="flex items-center gap-2 text-sm font-bold text-text mb-2">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  来月のネクストプラン
                </div>
                <p className="text-xs text-text2 mb-5">各メンバーが来月に向けた取り組み・目標・アクションプランを自由に記入してください。</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {MEMBERS.map(name => (
                    <div key={name} className="bg-white border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-2 text-xs font-bold text-accent mb-2">
                        <div className="w-2 h-2 rounded-full bg-accent" />
                        {name.replace('　', '')}
                      </div>
                      <LocalTextarea
                        className="w-full border border-border rounded-lg p-2.5 text-xs bg-bg focus:bg-white focus:border-accent outline-none min-h-[100px] transition-all leading-relaxed"
                        placeholder="来月の取り組み・目標・アクションプランを自由に記入..."
                        value={currentMonthData.nextPlan[name] || ''}
                        onChange={(val: string) => handleNextPlanChange(name, val)}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 mt-6">
                  <button 
                    onClick={handleNextPlanSave}
                    className="bg-accent hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center gap-2"
                  >
                    <Save size={16} />
                    全員分を保存する
                  </button>
                  {showSaveOk['next'] && (
                    <span className="text-xs text-green-600 font-medium animate-in fade-in slide-in-from-left-2">✓ 保存しました</span>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'overall' && (
            <motion.div
              key="overall"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-xl shadow-sm p-5 border border-border">
                <div className="flex items-center gap-2 text-sm font-bold text-text mb-4">
                  <div className="w-1 h-4 bg-accent rounded-full" />
                  全体稼働状況 ({currentYear}年{currentMonth + 1}月)
                </div>

                <div className="overflow-auto max-h-[calc(100vh-250px)] sm:max-h-[700px] -mx-5 px-5 relative border-b border-border">
                  <table className="w-full text-[9px] border-separate border-spacing-0 min-w-[max-content]">
                    <thead className="relative z-30">
                      <tr className="bg-accent-l text-accent">
                        <th className="p-1.5 border border-border font-bold sticky left-0 top-0 bg-accent-l z-50 min-w-[100px] text-left">
                          スタッフ名 / 集計
                        </th>
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          const day = i + 1;
                          const dow = getDow(currentYear, currentMonth, day);
                          const isSat = dow === 5;
                          const isSun = dow === 6;
                          return (
                            <th key={day} className={`p-1 border border-border font-bold text-center min-w-[70px] sticky top-0 z-30 ${
                              isSun ? 'text-red-600 bg-red-50' : isSat ? 'text-blue-600 bg-blue-50' : 'bg-accent-l'
                            }`}>
                              {day}({['月','火','水','木','金','土','日'][dow]})
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Row for workingCount (稼働数) */}
                      <tr className="bg-bg/50">
                        <td className="p-1.5 border border-border sticky left-0 bg-bg z-20 font-bold text-text">
                          稼働人数 (合計)
                        </td>
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                          let count = 0;
                          MEMBERS.forEach(name => {
                            const item = currentMonthData.schedule[name]?.[i] || { type: 'rest' };
                            if (item.type !== 'normal' && item.type !== 'request' && item.type !== 'rest') {
                              count++;
                            }
                          });
                          return (
                            <td key={i} className="p-1 border border-border text-center font-bold text-text">
                              {count}人
                            </td>
                          );
                        })}
                      </tr>

                      {/* Staff rows */}
                      {MEMBERS.map(name => {
                        const schedule = currentMonthData.schedule[name] || [];
                        const normalCount = schedule.filter(s => s.type === 'normal').length;
                        const requestCount = schedule.filter(s => s.type === 'request').length;

                        return (
                          <tr key={name} className="hover:bg-bg/40 transition-colors">
                            <td className="p-1.5 border border-border sticky left-0 bg-white z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between gap-1">
                                  <div className="font-bold text-accent text-[9px] truncate max-w-[50px]">{name.replace('　', '')}</div>
                                  <div className="flex gap-1 text-[7.5px] font-bold leading-none shrink-0">
                                    <span className="text-gray-500 whitespace-nowrap">公:{normalCount}</span>
                                    <span className="text-pink-600 whitespace-nowrap">希:{requestCount}</span>
                                  </div>
                                </div>
                                <LocalInput
                                  className="w-full px-1 py-0.5 rounded border border-accent/20 text-[7.5px] outline-none focus:border-accent bg-white/80 font-normal h-3.5"
                                  value={globalStations[name] || currentMonthData.memberStations?.[name] || ''}
                                  onChange={(val: string) => handleMemberStationChange(name, val)}
                                  placeholder="駅..."
                                />
                              </div>
                            </td>
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                              const item = currentMonthData.schedule[name]?.[i] || { type: 'rest', detail: '' };
                              return (
                                <td key={i} className="p-0.5 border border-border">
                                  <div className="flex flex-col gap-0.5">
                                    <select
                                      className={`w-full px-0.5 py-0.5 rounded-full text-[8px] font-bold outline-none border border-transparent focus:border-accent/30 transition-all ${TYPE_CLASS[item.type]}`}
                                      value={item.type}
                                      onChange={(e) => handleScheduleTypeChange(name, i, e.target.value as StatusType)}
                                    >
                                      {Object.keys(TYPE_LABEL).map(t => (
                                        <option key={t} value={t}>{TYPE_LABEL[t as StatusType].split('(')[0]}</option>
                                      ))}
                                    </select>
                                    <LocalInput
                                      className="w-full px-0.5 py-0.5 rounded border border-border text-[7.5px] outline-none focus:border-accent bg-white/50 focus:bg-white h-4"
                                      value={item.detail || ''}
                                      onChange={(val: string) => handleScheduleDetailChange(name, i, val)}
                                      placeholder="..."
                                    />
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="bg-white border-t border-border p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-[10px] text-text3">
          <Info size={12} />
          <span>データはサーバーにリアルタイム保存されます。リンクを知っている全員が閲覧・編集可能です。</span>
        </div>
      </footer>

      <BulkImportModal 
        isOpen={isImportOpen} 
        onClose={() => setIsImportOpen(false)} 
        onImport={handleBulkImport} 
      />
    </div>
  );
}
