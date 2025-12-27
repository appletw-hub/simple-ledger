
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Account, Transaction, TransactionType, ReceiptData, RecurringTransaction, Frequency } from './types';
import { INITIAL_ACCOUNTS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, TRANSFER_CATEGORY, PRESET_BANKS } from './constants';
import { TabNav } from './components/TabNav';
import { TransactionForm } from './components/TransactionForm';
import { analyzeReceipt, analyzeVoiceCommand, preprocessImage } from './services/geminiService';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, Legend } from 'recharts';
// @ts-ignore
import { jsPDF } from 'jspdf';
// @ts-ignore
import html2canvas from 'html2canvas';

const ACCOUNT_COLORS = [
  'bg-orange-500', 'bg-blue-500', 'bg-purple-500', 
  'bg-green-500', 'bg-red-500', 'bg-teal-500', 
  'bg-indigo-500', 'bg-pink-500', 'bg-gray-600'
];

const STORAGE_KEY = 'smartledger_storage_v1';

// Theme Definitions
type ThemeType = 'default' | 'purple' | 'coffee' | 'green';

// 1. Background Classes (Tailwind classes for the main page background)
const THEME_BG_CLASSES: Record<ThemeType, string> = {
  default: 'bg-[#F2F2F7]', 
  purple: 'bg-[#5F6094]',  
  coffee: 'bg-[#C1A994]',  
  green:  'bg-[#677D6A]',  
};

// Hex codes for html2canvas
const THEME_HEX_COLORS: Record<ThemeType, string> = {
  default: '#F2F2F7', 
  purple: '#5F6094',  
  coffee: '#C1A994',  
  green:  '#677D6A',  
};

// 2. Primary Color Definitions (RGB values for CSS variables)
// These colors are darker/deeper versions of the background to provide contrast (深淺落差)
// They will affect Buttons, Icons, and Active Tabs.
const THEME_CONFIG: Record<ThemeType, { primaryRGB: string }> = {
  default: { primaryRGB: '0 122 255' },   // #007AFF (iOS Blue)
  purple:  { primaryRGB: '72 73 115' },   // #484973 (Deep Purple) - Contrast to #5F6094
  coffee:  { primaryRGB: '143 113 90' },  // #8F715A (Deep Brown) - Contrast to #C1A994
  green:   { primaryRGB: '65 82 67' },    // #415243 (Deep Green) - Contrast to #677D6A
};

type AccountFormState = {
  id?: string;
  name: string;
  type: Account['type'];
  initialBalance: string;
  color: string;
};

type FilterState = {
  startDate: string;
  endDate: string;
  type: 'ALL' | TransactionType;
  categoryId: string;
  minAmount: string;
  maxAmount: string;
};

type SortConfig = {
  key: 'date' | 'amount';
  direction: 'asc' | 'desc';
};

const INITIAL_FILTERS: FilterState = {
  startDate: '',
  endDate: '',
  type: 'ALL',
  categoryId: '',
  minAmount: '',
  maxAmount: ''
};

// Chart Types Configuration with Icons
const CHART_TYPES = [
  { id: 'report', label: '月結報表', icon: 'ph-file-text' },
  { id: 'pie', label: '圓餅圖', icon: 'ph-chart-pie-slice' },
  { id: 'bar', label: '長條圖', icon: 'ph-chart-bar' },
  { id: 'trend', label: '收支趨勢', icon: 'ph-chart-line-up' },
] as const;

export default function App() {
  // --- Initialization ---
  // Load all data from LocalStorage once on mount for performance
  const [initialData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to load from storage", e);
      return {};
    }
  });

  // --- State ---
  // Initialize states using the loaded data
  const [accounts, setAccounts] = useState<Account[]>(initialData.accounts || INITIAL_ACCOUNTS);
  const [transactions, setTransactions] = useState<Transaction[]>(initialData.transactions || []);
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>(initialData.recurringTransactions || []);
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(initialData.theme || 'default');
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'accounts' | 'charts'>('dashboard');
  
  // View Modes
  const [historyView, setHistoryView] = useState<'list' | 'recurring'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'date', direction: 'desc' });
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [chartType, setChartType] = useState<'pie' | 'bar' | 'trend' | 'report'>('report');
  const [viewingAccount, setViewingAccount] = useState<Account | null>(null);
  
  // Reorder Mode State
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [draggedAccountIndex, setDraggedAccountIndex] = useState<number | null>(null);

  // Chart Selected Month
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  });

  // Form/Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false); 
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false); 
  const [pendingReceipt, setPendingReceipt] = useState<string | null>(null);
  const [pendingReceiptData, setPendingReceiptData] = useState<Partial<Transaction> | null>(null);
  const [isProcessingReceipt, setIsProcessingReceipt] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  
  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [accountFormState, setAccountFormState] = useState<AccountFormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // --- Persistence Effect ---
  // Automatically save to LocalStorage whenever key data changes with smart quota management
  useEffect(() => {
    const saveData = () => {
      const dataToSave = {
        accounts,
        transactions,
        recurringTransactions,
        theme: currentTheme
      };
      
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
      } catch (e: any) {
        // Handle QuotaExceededError
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
          console.warn("Storage full. Optimizing by removing old receipt images...");
          
          // Sort transactions by date descending (keep newest images)
          const sorted = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          
          // Strategy: Try to keep images for the newest N transactions, strip others.
          const totalWithImages = sorted.filter(t => t.receiptImage).length;
          let keepCount = Math.max(0, totalWithImages - 10); 

          while (keepCount >= 0) {
            const keepImageIds = new Set(
                sorted
                .filter(t => t.receiptImage)
                .slice(0, keepCount)
                .map(t => t.id)
            );

            const optimizedTransactions = transactions.map(t => {
               if (t.receiptImage && !keepImageIds.has(t.id)) {
                   const { receiptImage, ...rest } = t;
                   return rest;
               }
               return t;
            });

            const optimizedData = {
                accounts,
                transactions: optimizedTransactions,
                recurringTransactions,
                theme: currentTheme
            };

            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(optimizedData));
                console.log(`Saved successfully by keeping only ${keepCount} recent images.`);
                return;
            } catch (retryError) {
                keepCount -= 5;
                if (keepCount < 0 && keepCount > -5) keepCount = 0; 
            }
          }
        } else {
            console.error("Storage error:", e);
        }
      }
    };

    const timeout = setTimeout(saveData, 1000); 
    return () => clearTimeout(timeout);
  }, [accounts, transactions, recurringTransactions, currentTheme]);

  // --- Logic & Helpers ---
  const getNextDate = (dateStr: string, freq: Frequency): string => {
    const d = new Date(dateStr);
    if (freq === 'DAILY') d.setDate(d.getDate() + 1);
    else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7);
    else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + 1);
    else if (freq === 'YEARLY') d.setFullYear(d.getFullYear() + 1);
    else if (freq === 'BI_MONTHLY_ODD' || freq === 'BI_MONTHLY_EVEN') {
      d.setMonth(d.getMonth() + 1); 
      while (true) {
        const currentMonth = d.getMonth() + 1; 
        const isOdd = currentMonth % 2 !== 0;
        const isEven = currentMonth % 2 === 0;
        if ((freq === 'BI_MONTHLY_ODD' && isOdd) || (freq === 'BI_MONTHLY_EVEN' && isEven)) {
          break;
        }
        d.setMonth(d.getMonth() + 1);
      }
    }
    return d.toISOString().split('T')[0];
  };

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    let newTransactions: Transaction[] = [];
    let updatedRecurring: RecurringTransaction[] = [];
    let hasChanges = false;

    const updatedRecurrings = recurringTransactions.map(rt => {
      let tempRt = { ...rt };
      let generated = false;
      let loopCount = 0;
      while (tempRt.nextDueDate <= today && loopCount < 12) {
        if (tempRt.endDate && tempRt.nextDueDate > tempRt.endDate) {
          break;
        }
        const newTx: Transaction = {
          id: `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          date: tempRt.nextDueDate,
          amount: tempRt.amount,
          type: tempRt.type,
          category: tempRt.category,
          description: `${tempRt.description} (自動)`,
          location: tempRt.location,
          accountId: tempRt.accountId,
          toAccountId: tempRt.toAccountId,
          isRecurringInstance: true,
        };

        newTransactions.push(newTx);
        tempRt.lastGenerated = tempRt.nextDueDate;
        tempRt.nextDueDate = getNextDate(tempRt.nextDueDate, tempRt.frequency);
        generated = true;
        loopCount++;
      }
      if (generated) hasChanges = true;
      return tempRt;
    });

    if (hasChanges) {
      setTransactions(prev => [...newTransactions, ...prev]);
      setRecurringTransactions(updatedRecurrings);
    }
  }, [recurringTransactions]);

  const accountBalances = useMemo(() => {
    const bals = accounts.reduce((acc, account) => {
      acc[account.id] = account.initialBalance;
      return acc;
    }, {} as Record<string, number>);

    transactions.forEach(tx => {
      const amt = typeof tx.amount === 'number' ? tx.amount : parseFloat(String(tx.amount));
      if (isNaN(amt)) return;
      if (tx.type === 'INCOME') {
        bals[tx.accountId] += amt;
      } else if (tx.type === 'EXPENSE') {
        bals[tx.accountId] -= amt;
      } else if (tx.type === 'TRANSFER' && tx.toAccountId) {
        bals[tx.accountId] -= amt;
        bals[tx.toAccountId] += amt;
      }
    });
    return bals;
  }, [accounts, transactions]);

  const totalBalance = Object.values(accountBalances).reduce((a: number, b: number) => a + b, 0);

  const changeMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${year}-${month}`);
  };

  const monthlyStats = useMemo(() => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr) - 1; 

    const monthlyTx = transactions.filter(t => {
      if (!t.date) return false;
      const d = new Date(t.date);
      if (isNaN(d.getTime())) return false;
      return d.getMonth() === month && d.getFullYear() === year;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const income = monthlyTx.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const expense = monthlyTx.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    
    const categoryData: Record<string, number> = {};
    const expenseTx = monthlyTx.filter(t => t.type === 'EXPENSE');
    expenseTx.forEach(t => {
      const catName = EXPENSE_CATEGORIES.find(c => c.id === t.category)?.name || '其他';
      categoryData[catName] = (categoryData[catName] || 0) + t.amount;
    });

    const chartData = Object.entries(categoryData)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return { income, expense, chartData, hasData: monthlyTx.length > 0, monthlyTx };
  }, [transactions, selectedMonth]);

  const dashboardStats = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    const currentTx = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const currentIncome = currentTx.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
    const currentExpense = currentTx.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);

    const prevDate = new Date(currentYear, currentMonth - 1, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth();
    
    const prevTx = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });
    const prevIncome = prevTx.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
    const prevExpense = prevTx.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);

    return {
        income: currentIncome,
        expense: currentExpense,
        prevIncome: prevIncome,
        prevExpense: prevExpense
    };
  }, [transactions]);

  const monthlyTrendStats = useMemo(() => {
    const data: Record<string, { income: number; expense: number }> = {};
    transactions.forEach(tx => {
      if (!tx.date) return;
      const d = new Date(tx.date);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      if (!data[key]) {
        data[key] = { income: 0, expense: 0 };
      }
      if (tx.type === 'INCOME') {
        data[key].income += tx.amount;
      } else if (tx.type === 'EXPENSE') {
        data[key].expense += tx.amount;
      }
    });
    return Object.entries(data)
      .map(([name, val]) => ({ name, ...val }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsProcessingReceipt(true);
    
    try {
      // Step 1: Preprocess Image (Resize & Grayscale) for better OCR accuracy and speed
      const processedBase64 = await preprocessImage(file);
      setPendingReceipt(processedBase64);
      
      // Step 2: Send to AI
      const data = await analyzeReceipt(processedBase64);
      setPendingReceiptData({ ...data, type: 'EXPENSE' });
      setIsFormOpen(true);
    } catch (error) {
      console.error(error);
      alert("無法辨識收據，請手動輸入。");
      setPendingReceiptData(null);
      setIsFormOpen(true);
    } finally {
      setIsProcessingReceipt(false);
      event.target.value = '';
    }
  };

  const handleManualInput = () => {
    setPendingReceiptData(null); setEditingId(null); setPendingReceipt(null); setIsFormOpen(true);
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessingReceipt(true);
        
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          try {
             const data = await analyzeVoiceCommand(base64Audio, mimeType);
             setPendingReceiptData(data);
             setIsFormOpen(true);
          } catch (e) {
             console.error(e);
             alert("無法辨識語音，請重試");
          } finally {
             setIsProcessingReceipt(false);
             // Stop tracks to release microphone
             stream.getTracks().forEach(track => track.stop());
          }
        };
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error(err);
      alert("無法存取麥克風，請確認權限設定。");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCameraTrigger = () => document.getElementById('cameraInput')?.click();
  const handleFileTrigger = () => document.getElementById('fileInput')?.click();

  const handleSaveTransaction = (data: any, isDuplicate: boolean = false) => {
    const safeAmount = typeof data.amount === 'number' && !isNaN(data.amount) ? data.amount : 0;
    
    // 1. Handle Recurring Creation
    if (data.isRecurring) {
      const newRecurring: RecurringTransaction = {
        id: `rec_${Date.now()}`,
        frequency: data.frequency, 
        startDate: data.date, 
        // If editing an existing transaction to be recurring, start next cycle to avoid dupe on today
        nextDueDate: editingId && !isDuplicate ? getNextDate(data.date, data.frequency) : data.date, 
        endDate: data.endDate,
        amount: safeAmount, 
        type: data.type, 
        category: data.category, 
        description: data.description, 
        location: data.location, 
        accountId: data.accountId, 
        toAccountId: data.toAccountId,
      };
      setRecurringTransactions(prev => [...prev, newRecurring]);
    } 

    // 2. Handle Single Transaction (Update or Create)
    // We process the transaction if:
    // - It is NOT recurring (standard entry)
    // - OR We are Editing (must update the record being edited)
    // - OR It is a Duplicate (must create a new copy)
    const shouldSaveTransaction = !data.isRecurring || editingId || isDuplicate;

    if (shouldSaveTransaction) {
        if (editingId && !isDuplicate) {
            // Update existing
            setTransactions(prev => prev.map(t => t.id === editingId ? { ...t, ...data, amount: safeAmount } : t));
        } else {
            // Create New (Fresh or Duplicate)
            setTransactions(prev => [{ id: Date.now().toString(), ...data, amount: safeAmount }, ...prev]);
        }
    }

    setIsFormOpen(false); 
    setPendingReceipt(null); 
    setPendingReceiptData(null); 
    setEditingId(null);
  };

  const deleteRecurring = (id: string) => setRecurringTransactions(prev => prev.filter(r => r.id !== id));
  const deleteTransaction = (id: string) => { setTransactions(prev => prev.filter(t => t.id !== id)); };
  const openEditForm = (tx: Transaction) => { setEditingId(tx.id); setPendingReceiptData(tx); setPendingReceipt(tx.receiptImage || null); setIsFormOpen(true); };

  const handleAddAccount = () => setAccountFormState({ name: '', type: 'CASH', initialBalance: '0', color: ACCOUNT_COLORS[0] });
  const handleEditAccount = (acc: Account) => setAccountFormState({ id: acc.id, name: acc.name, type: acc.type, initialBalance: acc.initialBalance.toString(), color: acc.color });
  const handleSaveAccount = () => {
    if (!accountFormState) return;
    const initialBalance = parseInt(accountFormState.initialBalance) || 0;
    if (accountFormState.id) {
        setAccounts(prev => prev.map(a => a.id === accountFormState.id ? { ...a, ...accountFormState, initialBalance } : a));
    } else {
        setAccounts(prev => [...prev, { id: `acc_${Date.now()}`, ...accountFormState, initialBalance } as Account]);
    }
    setAccountFormState(null);
  };
  const handleDeleteAccount = (id: string) => { if (confirm("確定刪除？")) { setAccounts(prev => prev.filter(a => a.id !== id)); setAccountFormState(null); } };
  
  // Account Sorting Logic
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedAccountIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault(); // Necessary to allow dropping
    if (draggedAccountIndex === null || draggedAccountIndex === index) return;

    // Reorder array
    const newAccounts = [...accounts];
    const draggedItem = newAccounts[draggedAccountIndex];
    newAccounts.splice(draggedAccountIndex, 1);
    newAccounts.splice(index, 0, draggedItem);
    
    setAccounts(newAccounts);
    setDraggedAccountIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedAccountIndex(null);
  };

  const moveAccount = (fromIndex: number, direction: 'UP' | 'DOWN') => {
      const toIndex = direction === 'UP' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= accounts.length) return;
      
      const newAccounts = [...accounts];
      const temp = newAccounts[fromIndex];
      newAccounts[fromIndex] = newAccounts[toIndex];
      newAccounts[toIndex] = temp;
      setAccounts(newAccounts);
  };

  const resetFilters = () => { setFilters(INITIAL_FILTERS); setSearchTerm(''); setIsFilterModalOpen(false); };
  
  const filteredTransactions = useMemo(() => {
    let result = transactions;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
      result = result.filter(tx => (
        tx.description.toLowerCase().includes(term) || (tx.location && tx.location.toLowerCase().includes(term)) || (allCats.find(c => c.id === tx.category)?.name || '').toLowerCase().includes(term)
      ));
    }
    if (filters.startDate) result = result.filter(tx => tx.date >= filters.startDate);
    if (filters.endDate) result = result.filter(tx => tx.date <= filters.endDate);
    if (filters.type !== 'ALL') result = result.filter(tx => tx.type === filters.type);
    if (filters.categoryId) result = result.filter(tx => tx.category === filters.categoryId);
    if (filters.minAmount) result = result.filter(tx => tx.amount >= parseFloat(filters.minAmount));
    if (filters.maxAmount) result = result.filter(tx => tx.amount <= parseFloat(filters.maxAmount));
    return result;
  }, [transactions, searchTerm, filters]);

  const sortedTransactions = useMemo(() => {
    const data = [...filteredTransactions];
    data.sort((a, b) => {
      if (sortConfig.key === 'date') return sortConfig.direction === 'asc' ? new Date(a.date).getTime() - new Date(a.date).getTime() : new Date(b.date).getTime() - new Date(a.date).getTime();
      return sortConfig.direction === 'asc' ? a.amount - b.amount : b.amount - a.amount;
    });
    return data;
  }, [filteredTransactions, sortConfig]);

  const handleBackup = () => {
    const data = { accounts, transactions, recurringTransactions, theme: currentTheme, timestamp: new Date().toISOString(), version: "1.0" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `smartledger_backup_${new Date().toISOString().slice(0,10)}.json`; link.click(); setIsSettingsModalOpen(false);
  };
  const handleResetData = () => { setIsSettingsModalOpen(false); setIsResetConfirmOpen(true); };
  const executeReset = () => {
    setTransactions([]); setRecurringTransactions([]); setAccounts(JSON.parse(JSON.stringify(INITIAL_ACCOUNTS))); setFilters(INITIAL_FILTERS); setCurrentTheme('default');
    localStorage.removeItem(STORAGE_KEY); setIsResetConfirmOpen(false); alert("已重置");
  };
  const handleExportCSV = () => {
    const headers = ['日期', '類型', '金額', '分類', '備註', '地點', '帳戶', '轉入帳戶'];
    const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
    const rows = sortedTransactions.map(tx => [
        tx.date, tx.type === 'INCOME' ? '收入' : tx.type === 'EXPENSE' ? '支出' : '轉帳', Math.round(tx.amount), allCats.find(c => c.id === tx.category)?.name || tx.category, tx.description, tx.location || '', accounts.find(a => a.id === tx.accountId)?.name || '', tx.toAccountId ? accounts.find(a => a.id === tx.toAccountId)?.name || '' : ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(["\uFEFF" + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `smartledger_export_${new Date().toISOString().slice(0,10)}.csv`; link.click(); setIsSettingsModalOpen(false);
  };
  const handleExportAccountCSV = (targetAccount?: Account) => {
     const acc = targetAccount || viewingAccount;
     if(!acc) return;
     const accountTxs = transactions.filter(tx => tx.accountId === acc.id || tx.toAccountId === acc.id).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());
     const headers = ['日期', '類型', '金額', '分類', '備註', '地點', '對方帳戶'];
     const rows = accountTxs.map(tx => {
         const isIncome = (tx.type === 'INCOME' && tx.accountId === acc.id) || (tx.type === 'TRANSFER' && tx.toAccountId === acc.id);
         let typeLabel = tx.type === 'INCOME' ? '收入' : tx.type === 'EXPENSE' ? '支出' : '轉帳';
         if(tx.type==='TRANSFER') typeLabel = isIncome ? '轉入' : '轉出';
         const otherName = tx.type === 'TRANSFER' ? (isIncome ? accounts.find(a=>a.id===tx.accountId)?.name : accounts.find(a=>a.id===tx.toAccountId)?.name) : '-';
         return [tx.date, typeLabel, Math.round(tx.amount), [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY].find(c=>c.id===tx.category)?.name, tx.description, tx.location, otherName].map(v => `"${String(v||'').replace(/"/g, '""')}"`).join(',');
     });
     const blob = new Blob(["\uFEFF" + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
     const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${acc.name}_export.csv`; link.click();
  };

  const handleExportPDF = async () => {
    if (activeTab !== 'charts') { 
        setIsSettingsModalOpen(false);
        setActiveTab('charts'); 
        await new Promise(r => setTimeout(r, 500)); 
    } else {
        setIsSettingsModalOpen(false);
    }
    
    const input = document.getElementById('charts-analysis-view'); 
    if (!input) {
        alert("無法找到圖表內容");
        return;
    }

    setIsGeneratingPDF(true); 
    window.scrollTo(0, 0);

    try {
      await new Promise(r => setTimeout(r, 2000));
      
      const canvas = await html2canvas(input, { 
          scale: 3, 
          useCORS: true, 
          backgroundColor: '#FFFFFF', // Force white background for PDF
          scrollY: -window.scrollY, 
          windowWidth: document.documentElement.offsetWidth, 
          height: input.scrollHeight + 100, // Explicitly capture full height
          windowHeight: input.scrollHeight + 200, 
          onclone: (clonedDoc) => {
            const el = clonedDoc.getElementById('charts-analysis-view');
            if (el) {
                // Force full expansion
                el.style.height = 'auto';
                el.style.overflow = 'visible';
                el.style.backgroundColor = '#ffffff';

                // Remove clipping/truncation from numbers
                const truncated = el.querySelectorAll('.truncate');
                truncated.forEach((t: any) => {
                    t.classList.remove('truncate');
                    t.style.whiteSpace = 'normal';
                    t.style.overflow = 'visible';
                });

                // STRICT: Remove opacity/blur for 100% brightness/clarity
                // Also force text colors if they are somehow inherited wrong
                const elements = el.querySelectorAll('*');
                elements.forEach((e: any) => {
                    const style = window.getComputedStyle(e);
                    if (style.opacity !== '1') {
                        e.style.opacity = '1';
                    }
                    e.style.backdropFilter = 'none';
                    e.style.webkitBackdropFilter = 'none';
                    e.style.boxShadow = 'none'; // Remove shadows for cleaner print
                });
            }
          }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdfWidth = 210; 
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight]);
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`analysis_report_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) { 
        console.error(err);
        alert("匯出 PDF 失敗"); 
    } finally { 
        setIsGeneratingPDF(false); 
    }
  };

  // --- CSV Import Logic ---
  const handleImportTrigger = () => document.getElementById('importCsvInput')?.click();

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      try {
        const lines = text.split('\n');
        // Remove BOM if present
        if (lines[0].charCodeAt(0) === 0xFEFF) {
            lines[0] = lines[0].slice(1);
        }
        
        // Basic validation on header
        // Headers: 日期,類型,金額,分類,備註,地點,帳戶,轉入帳戶
        const firstLine = lines[0].replace(/"/g, '');
        if (!firstLine.includes('日期') || !firstLine.includes('金額')) {
             alert('檔案格式錯誤。請確認這是本應用程式匯出的 CSV 檔案。');
             return;
        }

        const newTransactions: Transaction[] = [];
        const updatedAccounts = [...accounts];
        let importedCount = 0;

        // Account mapping cache to avoid repeated lookups/creation in this loop if possible
        const getOrCreateAccountId = (name: string): string => {
            if (!name) return '';
            // Check existing in updatedAccounts (which accumulates new ones)
            const existing = updatedAccounts.find(a => a.name === name);
            if (existing) return existing.id;

            const newId = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            updatedAccounts.push({
                id: newId,
                name: name,
                type: 'CASH', // Default
                initialBalance: 0,
                color: ACCOUNT_COLORS[updatedAccounts.length % ACCOUNT_COLORS.length]
            });
            return newId;
        };

        const getCategoryId = (name: string, type: string): string => {
             const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
             const found = all.find(c => c.name === name);
             if (found) return found.id;
             if (type === 'INCOME') return 'cat_other_inc';
             if (type === 'TRANSFER') return 'cat_transfer';
             return 'cat_other_exp';
        };

        const normalizeDate = (dateStr: string) => {
            try {
                // Handle standard separators (- / .) and YYYY/M/D format
                const dateObj = new Date(dateStr.replace(/_/g, '-').replace(/\//g, '-').replace(/\./g, '-'));
                
                if (isNaN(dateObj.getTime())) return dateStr;
                
                const y = dateObj.getFullYear();
                const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            } catch (e) {
                return dateStr;
            }
        };

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Regex to split by comma, ignoring commas inside quotes
            const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
            
            // row[0]=Date, [1]=Type, [2]=Amount, [3]=Category, [4]=Desc, [5]=Loc, [6]=Acc, [7]=ToAcc
            if (row.length < 3) continue;

            // NORMALIZE DATE HERE to ensure YYYY-MM-DD
            const date = normalizeDate(row[0]);
            const typeRaw = row[1];
            const amount = parseFloat(row[2]);
            const catName = row[3];
            const desc = row[4];
            const loc = row[5];
            const accName = row[6];
            const toAccName = row[7];

            if (isNaN(amount) || !date) continue;

            let type: TransactionType = 'EXPENSE';
            if (typeRaw === '收入') type = 'INCOME';
            else if (typeRaw === '轉帳' || typeRaw === '轉入' || typeRaw === '轉出') type = 'TRANSFER';

            const accId = getOrCreateAccountId(accName);
            let toAccId = undefined;
            if (type === 'TRANSFER' && toAccName) {
                toAccId = getOrCreateAccountId(toAccName);
            } else if (!accId) {
                // Fallback to first account if CSV has no account name (unlikely for valid export)
                if (accounts.length > 0) {
                     // Can't do much without an account, defaulting to first existing one
                }
            }

            // Create Transaction
            newTransactions.push({
                id: `import_${Date.now()}_${i}_${Math.random().toString(36).substr(2,5)}`,
                date,
                amount,
                type,
                category: getCategoryId(catName, type),
                description: desc,
                location: loc,
                accountId: accId || accounts[0]?.id, // Fallback
                toAccountId: toAccId
            });
            importedCount++;
        }

        if (importedCount > 0) {
             setAccounts(updatedAccounts);
             setTransactions(prev => [...prev, ...newTransactions]);
             alert(`成功匯入 ${importedCount} 筆交易記錄！`);
             setIsSettingsModalOpen(false);
        } else {
            alert('CSV 檔案中沒有讀取到有效資料。');
        }

      } catch (e) {
          console.error(e);
          alert('匯入發生錯誤，請檢查檔案格式。');
      } finally {
          event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const getCategoryIcon = (catId: string, type: TransactionType) => {
    if (type === 'TRANSFER') return 'arrows-left-right';
    return (type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).find(c => c.id === catId)?.icon || 'question';
  };

  const renderAccountDetails = () => {
    if (!viewingAccount) return null;
    
    const accountTxs = transactions.filter(tx => 
      tx.accountId === viewingAccount.id || tx.toAccountId === viewingAccount.id
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col animate-slide-up">
         <div className="px-4 py-3 bg-surface flex items-center justify-between border-b shadow-sm z-10">
            <button onClick={() => setViewingAccount(null)} className="text-primary flex items-center gap-1"><i className="ph ph-caret-left text-xl"/> 返回</button>
            <h2 className="font-semibold text-lg">{viewingAccount.name}</h2>
            <button onClick={() => handleExportAccountCSV(viewingAccount!)} className="text-primary text-sm"><i className="ph ph-export text-xl"/></button>
         </div>

         <div className="flex-1 overflow-y-auto bg-[#F2F2F7] p-4">
             <div className={`rounded-2xl p-6 text-white shadow-xl mb-6 relative overflow-hidden ${viewingAccount.color}`}>
                <div className="relative z-10">
                   <div className="text-sm opacity-80 mb-1">目前餘額</div>
                   <div className="text-4xl font-bold">${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(accountBalances[viewingAccount.id] || 0)}</div>
                </div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -mr-8 -mt-8 pointer-events-none"></div>
             </div>

             <h3 className="font-bold text-gray-500 text-sm uppercase mb-3 px-1">近期交易</h3>
             <div className="space-y-3 pb-24">
                {accountTxs.length > 0 ? accountTxs.map(tx => {
                    const isIncome = (tx.type === 'INCOME' && tx.accountId === viewingAccount.id) || (tx.type === 'TRANSFER' && tx.toAccountId === viewingAccount.id);
                    const displayAmount = Math.round(tx.amount);
                    return (
                        <div key={tx.id} onClick={() => openEditForm(tx)} className="bg-surface p-4 rounded-2xl shadow-sm flex items-center gap-4 cursor-pointer active:scale-[0.99] transition-transform">
                             <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isIncome ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                                <i className={`ph ph-${getCategoryIcon(tx.category, tx.type)} text-xl`}/>
                             </div>
                             <div className="flex-1 min-w-0">
                               <div className="font-medium truncate">{tx.description}</div>
                               <div className="text-xs text-gray-500">{new Date(tx.date).toLocaleDateString()}</div>
                               {tx.location && <div className="text-[10px] text-gray-400 flex items-center gap-0.5"><i className="ph ph-map-pin-fill"/>{tx.location}</div>}
                             </div>
                             <div className={`font-bold ${isIncome ? 'text-yellow-600' : 'text-green-600'}`}>
                                {isIncome ? '+' : '-'}${displayAmount}
                             </div>
                        </div>
                    );
                }) : (
                    <div className="text-center text-gray-400 py-10">
                        <i className="ph ph-receipt text-4xl mb-2"/>
                        <p>尚無交易紀錄</p>
                    </div>
                )}
             </div>
         </div>
      </div>
    );
  };

  const CustomTooltip = ({ active, payload, label }: any) => { return active && payload && payload.length ? <div className="bg-white/90 p-2 border rounded shadow text-xs"><p>{label}</p><p className="text-primary font-bold">${payload[0].value}</p></div> : null; };

  const handleDashboardCardClick = (type: TransactionType) => {
    const now = new Date();
    // Get start and end of current month
    const year = now.getFullYear();
    const month = now.getMonth();
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);
    
    // Format to YYYY-MM-DD
    const format = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    setFilters({
        ...INITIAL_FILTERS,
        type: type,
        startDate: format(startDate),
        endDate: format(endDate)
    });
    setHistoryView('list');
    setActiveTab('transactions');
  };

  const renderDashboard = () => (
    <div className="space-y-6 animate-fade-in pb-24">
      <div className="flex justify-between items-center px-2 pt-2">
        <h2 className={`text-2xl font-bold ${currentTheme !== 'default' ? 'text-white drop-shadow-md' : 'text-gray-800'}`}>總覽</h2>
        <button onClick={() => setIsSettingsModalOpen(true)} className={`w-9 h-9 rounded-full bg-surface/80 backdrop-blur ${currentTheme !== 'default' ? 'text-primary' : 'text-gray-600'} flex items-center justify-center shadow-sm hover:bg-surface`}>
            <i className="ph ph-gear text-xl" />
        </button>
      </div>
      <div id="dashboard-summary" className="grid grid-cols-2 gap-3 px-1">
          <div onClick={() => handleDashboardCardClick('INCOME')} className={`${currentTheme === 'default' ? 'bg-yellow-50 border-yellow-100 text-yellow-600' : 'bg-primary/90 border-transparent shadow-lg shadow-black/10 text-yellow-300'} p-5 rounded-2xl border relative overflow-hidden shadow-sm flex flex-col justify-between h-32 transition-all duration-500 cursor-pointer active:scale-95`}>
             <div className={`absolute -right-3 -bottom-3 opacity-20 ${currentTheme === 'default' ? 'text-yellow-600' : 'text-yellow-300'}`}><i className="ph ph-arrow-down-left text-7xl" /></div>
             <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-1.5"><i className={`ph ph-arrow-down-left text-lg ${currentTheme === 'default' ? 'text-yellow-600' : 'text-yellow-300'} opacity-20`} /><span className="text-xs font-bold uppercase">收入</span></div>
                   <div className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">上月: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(dashboardStats.prevIncome)}</div>
                </div>
                <div className={`text-2xl font-bold ${currentTheme === 'default' ? 'text-yellow-700' : 'text-yellow-300'}`}>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(dashboardStats.income)}</div>
             </div>
          </div>
          <div onClick={() => handleDashboardCardClick('EXPENSE')} className={`${currentTheme === 'default' ? 'bg-green-50 border-green-100 text-green-600' : 'bg-primary/80 border-transparent shadow-lg shadow-black/10 text-green-300'} p-5 rounded-2xl border relative overflow-hidden shadow-sm flex flex-col justify-between h-32 transition-all duration-500 cursor-pointer active:scale-95`}>
             <div className={`absolute -right-3 -bottom-3 opacity-20 ${currentTheme === 'default' ? 'text-green-600' : 'text-green-300'}`}><i className="ph ph-arrow-up-right text-7xl" /></div>
             <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5"><i className={`ph ph-arrow-up-right text-lg ${currentTheme === 'default' ? 'text-green-600' : 'text-green-300'} opacity-20`} /><span className="text-xs font-bold uppercase">支出</span></div>
                    <div className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">上月: ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(dashboardStats.prevExpense)}</div>
                </div>
                <div className={`text-2xl font-bold ${currentTheme === 'default' ? 'text-green-700' : 'text-green-300'}`}>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(dashboardStats.expense)}</div>
             </div>
          </div>
      </div>
       <div>
        <div className="flex justify-between items-center px-2 mb-2">
          <h3 className={`font-semibold ${currentTheme !== 'default' ? 'text-white drop-shadow-sm' : 'text-gray-800'}`}>近期紀錄</h3>
          <button onClick={() => setActiveTab('transactions')} className={`${currentTheme !== 'default' ? 'text-white/80' : 'text-primary'} text-sm`}>查看全部</button>
        </div>
        <div className="space-y-3">
          {transactions.slice(0, 3).map(tx => (
            <div key={tx.id} onClick={() => openEditForm(tx)} className={`${currentTheme !== 'default' ? 'bg-primary/80 border-transparent text-white shadow-lg' : 'bg-surface shadow-sm'} p-4 rounded-2xl flex items-center gap-4 active:scale-[0.98] transition-transform cursor-pointer`}>
               <div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentTheme !== 'default' ? 'bg-white/20 text-white' : (tx.type === 'INCOME' ? 'bg-yellow-100 text-yellow-600' : tx.type === 'EXPENSE' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600')}`}><i className={`ph ph-${getCategoryIcon(tx.category, tx.type)} text-xl`} /></div>
               <div className="flex-1 min-w-0">
                 <div className={`font-medium truncate ${currentTheme !== 'default' ? 'text-white' : 'text-gray-900'}`}>{tx.description}</div>
                 <div className={`text-xs mt-0.5 ${currentTheme !== 'default' ? 'text-white/70' : 'text-gray-500'}`}>{new Date(tx.date).toLocaleDateString()}</div>
               </div>
               <div className={`font-bold whitespace-nowrap ${currentTheme !== 'default' ? (tx.type === 'INCOME' ? 'text-yellow-300' : tx.type === 'EXPENSE' ? 'text-green-300' : 'text-white') : (tx.type === 'INCOME' ? 'text-yellow-600' : tx.type === 'EXPENSE' ? 'text-green-600' : 'text-gray-900')}`}>{tx.type === 'EXPENSE' ? '-' : tx.type === 'INCOME' ? '+' : ''}${Math.round(tx.amount)}</div>
            </div>
          ))}
        </div>
       </div>
    </div>
  );

  return (
    <div 
      className={`min-h-screen font-sans text-gray-800 relative overflow-hidden transition-colors duration-500 ${THEME_BG_CLASSES[currentTheme]}`}
      style={{ '--color-primary': THEME_CONFIG[currentTheme].primaryRGB } as React.CSSProperties}
    >
      <main className="max-w-md mx-auto min-h-screen p-4 relative">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'accounts' && (
             <div className="pb-24 pt-4 px-1">
                <div className="px-1 mb-6">
                    <div className="bg-gradient-to-br from-primary to-primary/70 rounded-3xl p-6 text-white shadow-xl shadow-primary/20">
                    <div className="text-sm opacity-80 mb-1">資金流量</div>
                    <div className="text-4xl font-bold">${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(totalBalance))}</div>
                    </div>
                </div>
                <div className="flex justify-between items-end mb-6 px-2">
                    <h2 className={`text-2xl font-bold ${currentTheme !== 'default' ? 'text-white drop-shadow-md' : 'text-gray-800'}`}>帳戶列表</h2>
                    <div className="flex gap-2">
                         {isReorderMode ? (
                             <button onClick={() => setIsReorderMode(false)} className="bg-primary text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg shadow-primary/30 animate-fade-in">完成</button>
                         ) : (
                             <button onClick={() => setIsReorderMode(true)} className={`${currentTheme !== 'default' ? 'bg-white/20 text-white' : 'bg-white text-primary'} w-8 h-8 rounded-full flex items-center justify-center shadow-sm hover:scale-105 transition-transform`}><i className="ph ph-arrows-down-up text-lg"></i></button>
                         )}
                         <button onClick={handleAddAccount} className="bg-primary text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-110 transition-transform"><i className="ph ph-plus text-xl font-bold"></i></button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {accounts.map((acc, index) => (
                    <div 
                        key={acc.id} 
                        draggable={isReorderMode}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        onClick={() => !isReorderMode && setViewingAccount(acc)} 
                        className={`
                            ${currentTheme !== 'default' ? 'bg-primary/80 border-transparent text-white shadow-lg' : 'bg-surface shadow-sm'} 
                            rounded-2xl p-4 relative overflow-hidden transition-all duration-300 flex flex-col justify-between
                            ${isReorderMode ? 'cursor-grab scale-[0.98] ring-2 ring-primary ring-offset-2 ring-offset-[#F2F2F7] border-primary z-20' : 'cursor-pointer active:scale-[0.99]'}
                            ${draggedAccountIndex === index ? 'opacity-30' : 'opacity-100'}
                        `}
                    >
                        <div className={`absolute top-0 right-0 w-20 h-20 rounded-full -mr-5 -mt-5 ${currentTheme !== 'default' ? 'bg-white/10' : `${acc.color} opacity-10`}`} />
                        <div className="relative z-10 flex flex-col h-full justify-between">
                            {/* Top Row */}
                            <div className="flex justify-between items-start">
                                <div className={`p-2 rounded-lg ${currentTheme !== 'default' ? 'bg-white/20 text-white' : `${acc.color} bg-opacity-10 text-opacity-100 text-gray-800`}`}>
                                    {acc.type === 'CASH' && <i className="ph ph-wallet text-xl" />}
                                    {acc.type === 'BANK' && <i className="ph ph-bank text-xl" />}
                                    {acc.type === 'CREDIT' && <i className="ph ph-credit-card text-xl" />}
                                    {acc.type === 'E-WALLET' && <i className="ph ph-qr-code text-xl" />}
                                    {acc.type === 'OTHER' && <i className="ph ph-dots-three-circle text-xl" />}
                                </div>
                                <div className="-mr-1 -mt-1">
                                    {isReorderMode ? (
                                        <div className="flex gap-1 bg-white/20 rounded-lg p-1">
                                            <button disabled={index === 0} onClick={() => moveAccount(index, 'UP')} className="w-6 h-6 flex items-center justify-center rounded bg-white/80 text-primary disabled:opacity-30 hover:bg-white"><i className="ph ph-caret-left text-sm"/></button>
                                            <button disabled={index === accounts.length - 1} onClick={() => moveAccount(index, 'DOWN')} className="w-6 h-6 flex items-center justify-center rounded bg-white/80 text-primary disabled:opacity-30 hover:bg-white"><i className="ph ph-caret-right text-sm"/></button>
                                        </div>
                                    ) : (
                                        <button onClick={(e) => { e.stopPropagation(); handleEditAccount(acc); }} className={`w-8 h-8 flex items-center justify-center rounded-full ${currentTheme !== 'default' ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-primary/10 text-primary hover:bg-primary/20'} transition-colors`}><i className="ph ph-pencil-simple text-lg" /></button>
                                    )}
                                </div>
                            </div>
                            
                            {/* Bottom Row */}
                            <div className="flex justify-between items-end mt-3">
                                {isReorderMode ? (
                                     <div className="w-8 h-8 flex items-center justify-center rounded-full -ml-1 -mb-1 text-gray-400">
                                         <i className="ph ph-dots-six-vertical text-2xl"/>
                                     </div>
                                ) : (
                                    <button onClick={(e) => { e.stopPropagation(); handleExportAccountCSV(acc); }} className={`w-8 h-8 flex items-center justify-center rounded-full -ml-1 -mb-1 ${currentTheme !== 'default' ? 'bg-white/80 text-primary hover:bg-white' : 'bg-primary/10 text-primary hover:bg-primary/20'} transition-colors`}><i className="ph ph-export text-lg" /></button>
                                )}
                                
                                <div className="text-right">
                                    <div className={`text-[10px] font-bold uppercase tracking-wider ${currentTheme !== 'default' ? 'text-white/60' : 'text-gray-400'}`}>{acc.type === 'OTHER' ? '其他' : acc.type}</div>
                                    <h3 className={`text-sm font-medium truncate ${currentTheme !== 'default' ? 'text-white' : 'text-gray-700'}`}>{acc.name}</h3>
                                    <div className={`text-lg font-bold mt-0.5 truncate ${currentTheme !== 'default' ? 'text-white' : 'text-gray-800'}`}>${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(accountBalances[acc.id])}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    ))}
                </div>
            </div>
        )}
        {activeTab === 'charts' && (
            <div 
              id="charts-analysis-view" 
              className={`space-y-6 animate-fade-in pb-24 ${isGeneratingPDF ? 'bg-white text-gray-900' : ''}`}
            >
                
                {/* PDF Report Header (Visible only during export) */}
                {isGeneratingPDF && (
                    <div className="text-center pb-4 pt-2">
                         <div className={`text-2xl font-bold mb-1 ${isGeneratingPDF ? 'text-gray-900' : (currentTheme !== 'default' ? 'text-white' : 'text-gray-800')}`}>簡單帳本 財務分析報表</div>
                         <div className={`text-sm ${isGeneratingPDF ? 'text-gray-600' : (currentTheme !== 'default' ? 'text-white/70' : 'text-gray-500')}`}>匯出日期: {new Date().toISOString().split('T')[0]}</div>
                    </div>
                )}

                {/* App Header (Hidden during export) */}
                <div className={`px-2 pt-2 flex justify-between items-center ${isGeneratingPDF ? 'hidden' : ''}`}>
                    <h2 className={`text-2xl font-bold ${currentTheme !== 'default' ? 'text-white drop-shadow-md' : 'text-gray-800'}`}>分析圖表</h2>
                    <button 
                      onClick={handleExportPDF} 
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 ${
                        isGeneratingPDF ? 'opacity-0 pointer-events-none' : ''
                      } ${
                        currentTheme !== 'default' 
                          ? 'bg-white/20 text-white hover:bg-white/30' 
                          : 'bg-white text-primary hover:bg-gray-50'
                      }`}
                    >
                      <i className="ph ph-export text-lg" />
                      <span>匯出</span>
                    </button>
                </div>
                
                <div className={`flex items-center justify-center px-2 relative ${isGeneratingPDF ? 'text-gray-900' : (currentTheme !== 'default' ? 'text-white/80' : 'text-gray-500')}`}>
                    {/* Hide arrows completely during export */}
                    {!isGeneratingPDF && <button onClick={() => changeMonth(-1)} className="p-1 absolute left-2"><i className="ph ph-caret-left text-lg"/></button>}
                    <span className="font-medium text-lg">{selectedMonth}</span>
                    {!isGeneratingPDF && <button onClick={() => changeMonth(1)} className="p-1 absolute right-2"><i className="ph ph-caret-right text-lg"/></button>}
                </div>

                <div className={`bg-surface/80 backdrop-blur rounded-xl mx-2 grid grid-cols-4 gap-1 transition-all duration-300 ${isGeneratingPDF ? 'opacity-0 h-0 overflow-hidden m-0 p-0' : 'p-1'}`}>
                    {CHART_TYPES.map((type) => (
                        <button 
                          key={type.id} 
                          onClick={() => setChartType(type.id as any)} 
                          className={`py-2 rounded-lg text-xs font-medium transition-all flex flex-col items-center justify-center gap-1.5 whitespace-nowrap ${
                            chartType === type.id 
                              ? 'bg-primary text-white shadow-sm' 
                              : 'text-gray-500 hover:bg-black/5'
                          }`}
                        >
                            <i className={`ph ${type.icon} text-xl`} />
                            <span>{type.label}</span>
                        </button>
                    ))}
                </div>

                {chartType === 'report' ? (
                     <div className={`bg-white mx-2 mt-4 p-5 rounded-3xl min-h-[400px] flex flex-col ${isGeneratingPDF ? 'border border-gray-300 rounded-xl' : 'shadow-sm border border-gray-100'}`}>
                         <div className="text-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800">財務報表</h3>
                            <p className="text-gray-500 text-sm">{selectedMonth}</p>
                         </div>
                         
                         {monthlyStats.hasData ? (
                             <>
                                <div className="grid grid-cols-3 gap-2 mb-8">
                                    <div className="bg-yellow-50 p-2 py-3 rounded-2xl text-center flex flex-col justify-center">
                                        <div className="text-[10px] text-yellow-600 font-bold uppercase mb-1 tracking-wider">收入</div>
                                        <div className="text-lg font-bold text-gray-900 px-1 leading-tight">
                                            ${new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(monthlyStats.income)}
                                        </div>
                                    </div>
                                    <div className="bg-green-50 p-2 py-3 rounded-2xl text-center flex flex-col justify-center">
                                        <div className="text-[10px] text-green-600 font-bold uppercase mb-1 tracking-wider">支出</div>
                                        <div className="text-lg font-bold text-gray-900 px-1 leading-tight">
                                             ${new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(monthlyStats.expense)}
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 p-2 py-3 rounded-2xl text-center flex flex-col justify-center">
                                        <div className="text-[10px] text-gray-500 font-bold uppercase mb-1 tracking-wider">結餘</div>
                                        <div className={`text-lg font-bold px-1 leading-tight ${monthlyStats.income - monthlyStats.expense >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                             ${new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 }).format(monthlyStats.income - monthlyStats.expense)}
                                        </div>
                                    </div>
                                </div>

                                <div className="h-72 relative mb-6"> 
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie 
                                                data={monthlyStats.chartData} 
                                                innerRadius={60} 
                                                outerRadius={80} 
                                                dataKey="value"
                                                paddingAngle={5}
                                            >
                                                {monthlyStats.chartData.map((e, i) => (
                                                    <Cell key={i} fill={['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'][i % 6]} strokeWidth={2} stroke="#fff" />
                                                ))}
                                            </Pie>
                                            <Legend 
                                                layout="horizontal" 
                                                verticalAlign="bottom" 
                                                align="center"
                                                iconType="circle"
                                                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="space-y-0 border-t border-gray-100 pt-2">
                                    {monthlyStats.chartData.map((e, i) => (
                                        <div key={i} className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0 text-sm hover:bg-gray-50 transition-colors px-2 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'][i % 6] }}></div>
                                                <span className="font-medium text-gray-700">{e.name}</span>
                                            </div>
                                            <span className="font-bold text-gray-800">${new Intl.NumberFormat('en-US').format(e.value)}</span>
                                        </div>
                                    ))}
                                </div>
                             </>
                         ) : (
                             <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] text-gray-300">
                                <i className="ph ph-folder-notch-open text-5xl mb-3" />
                                <p className="font-medium">本月暫無數據</p>
                             </div>
                         )}
                     </div>
                ) : chartType === 'trend' ? (
                    <div className={`bg-surface rounded-3xl p-5 mx-1 h-72 ${isGeneratingPDF ? 'border border-gray-300 rounded-xl' : 'shadow-sm'}`}>
                        <ResponsiveContainer>
                            <BarChart data={monthlyTrendStats}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB"/>
                                <XAxis dataKey="name" tick={{fontSize:10}} tickLine={false} axisLine={false}/>
                                <YAxis hide/>
                                <Tooltip cursor={{fill: 'transparent'}}/>
                                <Legend/>
                                <Bar dataKey="income" fill="#EAB308" radius={[4,4,0,0]} name="收入"/>
                                <Bar dataKey="expense" fill="#22C55E" radius={[4,4,0,0]} name="支出"/>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className={`bg-surface rounded-3xl p-5 mx-1 min-h-[300px] h-auto ${isGeneratingPDF ? 'border border-gray-300 rounded-xl' : 'shadow-sm'}`}>
                        {monthlyStats.hasData ? (
                            <ResponsiveContainer width="100%" height={300}>
                                {chartType==='pie' ? (
                                    <PieChart>
                                        <Pie data={monthlyStats.chartData} innerRadius={70} outerRadius={100} dataKey="value" paddingAngle={2}>
                                            {monthlyStats.chartData.map((e,i)=><Cell key={i} fill={['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40'][i%6]}/>)}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip/>}/>
                                        <Legend/>
                                    </PieChart>
                                ) : (
                                    <BarChart data={monthlyStats.chartData} layout="horizontal" margin={{top: 20, right: 0, left: 0, bottom: 0}}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB"/>
                                        <XAxis dataKey="name" tick={{fontSize:12}} tickLine={false} axisLine={false}/>
                                        <YAxis hide/>
                                        <Tooltip cursor={{fill: 'transparent'}} content={<CustomTooltip/>}/>
                                        <Bar dataKey="value" radius={[6,6,0,0]} barSize={40}>
                                            {monthlyStats.chartData.map((e,i)=><Cell key={i} fill={['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40'][i%6]}/>)}
                                            <LabelList dataKey="value" position="top" fill="#6B7280" fontSize={12} formatter={(val: number) => `$${val}`}/>
                                        </Bar>
                                    </BarChart>
                                )}
                            </ResponsiveContainer>
                        ) : (
                             <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                                <i className="ph ph-chart-bar text-4xl mb-2" />
                                <p>本月暫無數據</p>
                             </div>
                        )}
                    </div>
                )}
                
                {/* Transaction List for PDF Export - Only Visible when Generating PDF */}
                {isGeneratingPDF && monthlyStats.hasData && (
                    <div className="mx-2 mt-4 bg-white p-4 rounded-xl border border-gray-300">
                        <h4 className="font-bold text-gray-800 mb-4 pb-2 border-b border-gray-100 flex items-center gap-2">
                            <i className="ph ph-list-dashes text-lg text-primary"/>
                            交易明細
                        </h4>
                        <table className="w-full text-xs text-left border-collapse">
                            <thead>
                                <tr className="text-gray-400 font-medium border-b border-gray-100">
                                    <th className="py-2 pl-1">日期</th>
                                    <th className="py-2">類別/說明</th>
                                    <th className="py-2 text-right pr-1">金額</th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthlyStats.monthlyTx.map((tx, idx) => {
                                    const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
                                    const catName = allCats.find(c => c.id === tx.category)?.name || '其他';
                                    return (
                                        <tr key={tx.id || idx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                                            <td className="py-3 pl-1 font-mono text-gray-500">{tx.date.slice(5)}</td>
                                            <td className="py-3">
                                                <div className="font-bold text-gray-800 mb-0.5">{catName}</div>
                                                <div className="text-gray-500 truncate max-w-[150px]">{tx.description}</div>
                                            </td>
                                            <td className={`py-3 text-right pr-1 font-bold ${tx.type === 'INCOME' ? 'text-yellow-600' : tx.type === 'EXPENSE' ? 'text-green-600' : 'text-gray-600'}`}>
                                                {tx.type === 'EXPENSE' ? '-' : tx.type === 'INCOME' ? '+' : ''}{new Intl.NumberFormat('en-US').format(Math.round(tx.amount))}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Footer for PDF Export */}
                {isGeneratingPDF && (
                    <div className="text-center mt-8 text-xs text-gray-400">
                        Generated by 簡單帳本 AI
                    </div>
                )}
            </div>
        )}
        {activeTab === 'transactions' && (
            <div className="pb-24 pt-4 px-1">
                <div className="flex flex-col gap-4 mb-4 px-2">
                    <div className="flex justify-between items-center">
                        <h2 className={`text-2xl font-bold ${currentTheme !== 'default' ? 'text-white drop-shadow-md' : 'text-gray-800'}`}>{historyView === 'list' ? '帳務記錄' : '週期性設定'}</h2>
                        <div className="bg-surface/80 backdrop-blur p-1 rounded-lg flex"><button onClick={() => setHistoryView('list')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${historyView === 'list' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}>列表</button><button onClick={() => setHistoryView('recurring')} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${historyView === 'recurring' ? 'bg-primary text-white shadow-sm' : 'text-gray-500'}`}>週期性</button></div>
                    </div>
                    {historyView==='list' && <div className="flex gap-2"><div className="flex-1 relative"><i className="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="搜尋..." value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="w-full bg-surface/90 backdrop-blur pl-9 pr-4 py-2.5 rounded-xl shadow-sm outline-none text-sm"/></div><button onClick={()=>setIsSortMenuOpen(true)} className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${isSortMenuOpen?'bg-primary text-white':'bg-surface/90 text-gray-500'}`}><i className="ph ph-arrows-down-up"/></button><button onClick={()=>setIsFilterModalOpen(true)} className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${(filters.startDate||filters.endDate||filters.type!=='ALL'||filters.minAmount)?'bg-primary text-white':'bg-surface/90 text-gray-500'}`}><i className="ph ph-funnel"/></button></div>}
                </div>
                {historyView === 'list' ? <div className="space-y-3">{sortedTransactions.map(tx => <div key={tx.id} onClick={()=>openEditForm(tx)} className={`${currentTheme !== 'default' ? 'bg-primary/80 border-transparent text-white shadow-lg' : 'bg-surface shadow-sm'} p-4 rounded-2xl flex items-center gap-4 cursor-pointer active:scale-[0.99] transition-transform`}><div className={`w-10 h-10 rounded-full flex items-center justify-center ${currentTheme !== 'default' ? 'bg-white/20 text-white' : (tx.type === 'INCOME' ? 'bg-yellow-100 text-yellow-600' : tx.type === 'EXPENSE' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600')}`}><i className={`ph ph-${getCategoryIcon(tx.category,tx.type)} text-xl`}/></div><div className="flex-1 min-w-0"><div className={`font-medium truncate ${currentTheme !== 'default' ? 'text-white' : 'text-gray-900'}`}>{tx.description}</div><div className={`text-xs ${currentTheme !== 'default' ? 'text-white/70' : 'text-gray-500'}`}>{new Date(tx.date).toLocaleDateString()}</div>{tx.location && <div className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${currentTheme !== 'default' ? 'text-white/60' : 'text-gray-400'}`}><i className="ph ph-map-pin-fill"/>{tx.location}</div>}</div><div className={`font-bold ${currentTheme !== 'default' ? (tx.type === 'INCOME' ? 'text-yellow-300' : tx.type === 'EXPENSE' ? 'text-green-300' : 'text-white') : (tx.type === 'INCOME' ? 'text-yellow-600' : tx.type === 'EXPENSE' ? 'text-green-600' : 'text-gray-900')}`}>{Math.round(tx.amount)}</div></div>)}</div> : <div className="space-y-3">{recurringTransactions.map(rec => <div key={rec.id} className={`${currentTheme !== 'default' ? 'bg-primary/80 border-transparent text-white shadow-lg' : 'bg-surface shadow-sm'} p-4 rounded-2xl flex items-center gap-4 border-l-4 border-blue-500`}><div className="flex-1"><div className={`font-medium ${currentTheme !== 'default' ? 'text-white' : 'text-gray-900'}`}>{rec.description}</div><div className={`text-xs ${currentTheme !== 'default' ? 'text-white/70' : 'text-gray-500'}`}>下次: {rec.nextDueDate}</div></div><button onClick={()=>deleteRecurring(rec.id)} className="text-danger text-xs bg-red-50 px-2 py-1 rounded">停止</button></div>)}</div>}
            </div>
        )}
      </main>

      {/* Sort Menu UI */}
      {isSortMenuOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[1px] flex items-end animate-fade-in" onClick={() => setIsSortMenuOpen(false)}>
          <div className="w-full bg-surface rounded-t-3xl p-6 pb-8 animate-slide-up shadow-2xl" onClick={e => e.stopPropagation()}>
             <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6"></div>
             <h3 className="text-lg font-bold text-gray-800 mb-4 px-2">排序方式</h3>
             <div className="space-y-2">
                <button onClick={() => { setSortConfig({ key: 'date', direction: 'desc' }); setIsSortMenuOpen(false); }} className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors ${sortConfig.key === 'date' && sortConfig.direction === 'desc' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-gray-50 text-gray-600'}`}>
                    <div className="flex items-center gap-3"><i className="ph ph-calendar-blank text-xl"/><span>日期：由新到舊</span></div>
                    {sortConfig.key === 'date' && sortConfig.direction === 'desc' && <i className="ph ph-check text-xl"/>}
                </button>
                <button onClick={() => { setSortConfig({ key: 'date', direction: 'asc' }); setIsSortMenuOpen(false); }} className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors ${sortConfig.key === 'date' && sortConfig.direction === 'asc' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-gray-50 text-gray-600'}`}>
                    <div className="flex items-center gap-3"><i className="ph ph-calendar-blank text-xl"/><span>日期：由舊到新</span></div>
                    {sortConfig.key === 'date' && sortConfig.direction === 'asc' && <i className="ph ph-check text-xl"/>}
                </button>
                <div className="h-px bg-gray-100 my-2"></div>
                <button onClick={() => { setSortConfig({ key: 'amount', direction: 'desc' }); setIsSortMenuOpen(false); }} className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors ${sortConfig.key === 'amount' && sortConfig.direction === 'desc' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-gray-50 text-gray-600'}`}>
                    <div className="flex items-center gap-3"><i className="ph ph-money text-xl"/><span>金額：由高到低</span></div>
                    {sortConfig.key === 'amount' && sortConfig.direction === 'desc' && <i className="ph ph-check text-xl"/>}
                </button>
                <button onClick={() => { setSortConfig({ key: 'amount', direction: 'asc' }); setIsSortMenuOpen(false); }} className={`w-full p-4 rounded-xl flex items-center justify-between transition-colors ${sortConfig.key === 'amount' && sortConfig.direction === 'asc' ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-gray-50 text-gray-600'}`}>
                    <div className="flex items-center gap-3"><i className="ph ph-money text-xl"/><span>金額：由低到高</span></div>
                    {sortConfig.key === 'amount' && sortConfig.direction === 'asc' && <i className="ph ph-check text-xl"/>}
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Filter Modal UI */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center sm:justify-center animate-fade-in" onClick={() => setIsFilterModalOpen(false)}>
           <div className="w-full sm:w-auto sm:min-w-[400px] bg-surface rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl font-bold text-gray-800">篩選條件</h3>
                 <button onClick={() => setIsFilterModalOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"><i className="ph ph-x"/></button>
              </div>

              <div className="space-y-6 flex-1 overflow-y-auto px-1 pb-4">
                  {/* Type Filter */}
                  <div>
                      <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">交易類型</label>
                      <div className="bg-gray-100 p-1 rounded-xl flex">
                          {(['ALL', 'EXPENSE', 'INCOME', 'TRANSFER'] as const).map(t => (
                              <button 
                                key={t}
                                onClick={() => setFilters({...filters, type: t, categoryId: ''})} // Reset category when type changes
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${filters.type === t ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}
                              >
                                  {t === 'ALL' ? '全部' : t === 'EXPENSE' ? '支出' : t === 'INCOME' ? '收入' : '轉帳'}
                              </button>
                          ))}
                      </div>
                  </div>

                  {/* Date Range */}
                  <div className="grid grid-cols-2 gap-3">
                      <div>
                          <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">開始日期</label>
                          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="w-full bg-gray-50 p-3 rounded-xl outline-none text-sm font-medium"/>
                      </div>
                      <div>
                          <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">結束日期</label>
                          <input type="date" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} className="w-full bg-gray-50 p-3 rounded-xl outline-none text-sm font-medium"/>
                      </div>
                  </div>

                   {/* Amount Range */}
                   <div className="grid grid-cols-2 gap-3">
                      <div>
                          <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">最低金額</label>
                          <input type="number" placeholder="0" value={filters.minAmount} onChange={e => setFilters({...filters, minAmount: e.target.value})} className="w-full bg-gray-50 p-3 rounded-xl outline-none text-sm font-medium"/>
                      </div>
                      <div>
                          <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">最高金額</label>
                          <input type="number" placeholder="無上限" value={filters.maxAmount} onChange={e => setFilters({...filters, maxAmount: e.target.value})} className="w-full bg-gray-50 p-3 rounded-xl outline-none text-sm font-medium"/>
                      </div>
                  </div>

                  {/* Category Filter (Show only if type is selected and not ALL) */}
                  {filters.type !== 'ALL' && (
                      <div className="animate-fade-in">
                          <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">分類篩選</label>
                          <div className="grid grid-cols-4 gap-2">
                             <button onClick={() => setFilters({...filters, categoryId: ''})} className={`py-2 rounded-xl text-[10px] font-bold border transition-all ${!filters.categoryId ? 'bg-primary/10 border-primary text-primary' : 'border-gray-200 text-gray-500'}`}>全部</button>
                             {(filters.type === 'EXPENSE' ? EXPENSE_CATEGORIES : filters.type === 'INCOME' ? INCOME_CATEGORIES : [TRANSFER_CATEGORY]).map(cat => (
                                 <button 
                                   key={cat.id} 
                                   onClick={() => setFilters({...filters, categoryId: filters.categoryId === cat.id ? '' : cat.id})}
                                   className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all ${filters.categoryId === cat.id ? 'bg-primary/10 border-primary text-primary' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                                 >
                                     <i className={`ph ph-${cat.icon} text-lg mb-0.5`}/>
                                     <span className="text-[9px] truncate w-full text-center px-1">{cat.name}</span>
                                 </button>
                             ))}
                          </div>
                      </div>
                  )}
              </div>

              <div className="flex gap-3 mt-4 border-t border-gray-100 pt-4">
                  <button onClick={resetFilters} className="flex-1 py-3 text-gray-500 font-bold bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">重置</button>
                  <button onClick={() => setIsFilterModalOpen(false)} className="flex-1 py-3 text-white font-bold bg-primary rounded-xl shadow-lg shadow-primary/30 active:scale-95 transition-transform">確認篩選</button>
              </div>
           </div>
        </div>
      )}

      {renderAccountDetails()}
      
      {/* Recording Overlay */}
      {isRecording && (
        <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col items-center justify-center text-white p-4 animate-fade-in">
           <div className="mb-8 relative">
               <div className="w-24 h-24 rounded-full bg-red-500 animate-ping absolute opacity-50"></div>
               <div className="w-24 h-24 rounded-full bg-red-600 flex items-center justify-center relative z-10 shadow-2xl shadow-red-500/50">
                   <i className="ph ph-microphone text-5xl text-white"></i>
               </div>
           </div>
           <h3 className="text-2xl font-bold mb-2">正在錄音...</h3>
           <p className="text-white/60 text-sm mb-12">請描述您的消費，例如：「午餐吃排骨飯 100 元」</p>
           
           <button 
             onClick={handleStopRecording}
             className="w-full max-w-xs bg-white text-red-600 py-4 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
           >
             <i className="ph ph-stop-circle text-2xl"></i>
             停止並分析
           </button>
        </div>
      )}

      {/* Processing State */}
      {isProcessingReceipt && <div className="fixed inset-0 z-50 bg-black/50 flex flex-col items-center justify-center text-white backdrop-blur-sm animate-fade-in"><div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mb-4"></div><p className="font-medium text-lg">AI 正在分析...</p></div>}
      
      {isGeneratingPDF && <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center text-white"><p>正在產生 PDF...</p></div>}

      <input type="file" id="cameraInput" accept="image/*" capture="environment" className="hidden" onChange={handleFileUpload} />
      <input type="file" id="fileInput" accept="image/*" className="hidden" onChange={handleFileUpload} />
      <input type="file" id="importCsvInput" accept=".csv" className="hidden" onChange={handleImportCSV} />

      {isFormOpen && <TransactionForm accounts={accounts} accountBalances={accountBalances} onClose={() => { setIsFormOpen(false); setPendingReceipt(null); setEditingId(null); }} onSubmit={handleSaveTransaction} receiptImage={pendingReceipt} initialData={pendingReceiptData} onDelete={() => { if(confirm('確定刪除此紀錄？')) { deleteTransaction(editingId!); setIsFormOpen(false); setEditingId(null); } }} />}

      {isAddMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center sm:justify-center animate-fade-in" onClick={() => setIsAddMenuOpen(false)}>
          <div className="w-full sm:w-auto sm:min-w-[350px] bg-surface rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
             <h3 className="text-xl font-bold text-gray-800 mb-6 text-center">新增記錄方式</h3>
             
             <button onClick={() => { setIsAddMenuOpen(false); handleManualInput(); }} className="w-full bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                        <i className="ph ph-pencil-simple text-2xl"/>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800">手動輸入</div>
                        <div className="text-xs text-gray-500">自行輸入金額與分類</div>
                    </div>
                </div>
                <i className="ph ph-caret-right text-gray-300"/>
             </button>

             <button onClick={() => { setIsAddMenuOpen(false); handleStartRecording(); }} className="w-full bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-pink-50 text-pink-600 flex items-center justify-center">
                        <i className="ph ph-microphone text-2xl"/>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800">語音輸入</div>
                        <div className="text-xs text-gray-500">AI 語義辨識自動記帳</div>
                    </div>
                </div>
                <i className="ph ph-caret-right text-gray-300"/>
             </button>

             <button onClick={() => { setIsAddMenuOpen(false); handleCameraTrigger(); }} className="w-full bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center">
                        <i className="ph ph-camera text-2xl"/>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800">掃描(拍照)</div>
                        <div className="text-xs text-gray-500">使用相機拍攝收據</div>
                    </div>
                </div>
                <i className="ph ph-caret-right text-gray-300"/>
             </button>

             <button onClick={() => { setIsAddMenuOpen(false); handleFileTrigger(); }} className="w-full bg-white rounded-2xl p-4 mb-3 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                        <i className="ph ph-image text-2xl"/>
                    </div>
                    <div className="text-left">
                        <div className="font-bold text-gray-800">上傳(檔案)</div>
                        <div className="text-xs text-gray-500">從相簿/檔案選取收據</div>
                    </div>
                </div>
                <i className="ph ph-caret-right text-gray-300"/>
             </button>

             <button onClick={() => setIsAddMenuOpen(false)} className="mt-4 w-full py-3 text-gray-500 font-medium rounded-xl hover:bg-gray-100">取消</button>
          </div>
        </div>
      )}

      {/* Account Form Modal */}
      {accountFormState && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center sm:justify-center animate-fade-in" onClick={() => setAccountFormState(null)}>
          <div className="w-full sm:w-auto sm:min-w-[350px] bg-surface rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-800 mb-6">{accountFormState.id ? '編輯帳戶' : '新增帳戶'}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">帳戶類型</label>
                <div className="grid grid-cols-5 gap-1">
                  {(['CASH', 'BANK', 'CREDIT', 'E-WALLET', 'OTHER'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setAccountFormState({...accountFormState, type: t})}
                      className={`py-2 rounded-xl text-[9px] font-bold transition-all ${accountFormState.type === t ? 'bg-primary text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {t === 'CASH' ? '現金' : t === 'BANK' ? '銀行' : t === 'CREDIT' ? '信用卡' : t === 'E-WALLET' ? '電子' : '其他'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">帳戶名稱</label>
                <input 
                  type="text" 
                  value={accountFormState.name}
                  onChange={e => setAccountFormState({...accountFormState, name: e.target.value})}
                  className="w-full bg-gray-50 p-3 rounded-xl outline-none font-medium focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="輸入名稱..."
                />
                {accountFormState.type === 'BANK' && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {PRESET_BANKS.map(bank => (
                      <button 
                        key={bank}
                        onClick={() => setAccountFormState({...accountFormState, name: bank})}
                        className="px-3 py-1 bg-blue-50 text-blue-600 text-xs rounded-full font-medium hover:bg-blue-100 transition-colors"
                      >
                        {bank}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">初始金額</label>
                <input 
                  type="number" 
                  value={accountFormState.initialBalance}
                  onChange={e => setAccountFormState({...accountFormState, initialBalance: e.target.value})}
                  className="w-full bg-gray-50 p-3 rounded-xl outline-none font-medium focus:bg-white focus:ring-2 focus:ring-primary/20 transition-all"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-bold uppercase mb-2 block">代表顏色</label>
                <div className="flex flex-wrap gap-3">
                  {ACCOUNT_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setAccountFormState({...accountFormState, color: c})}
                      className={`w-8 h-8 rounded-full ${c} transition-transform ${accountFormState.color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-110 opacity-70 hover:opacity-100'}`}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                {accountFormState.id && (
                  <button 
                    onClick={() => handleDeleteAccount(accountFormState.id!)}
                    className="p-4 rounded-xl bg-red-50 text-danger hover:bg-red-100 transition-colors"
                  >
                    <i className="ph ph-trash text-xl" />
                  </button>
                )}
                <button 
                  onClick={handleSaveAccount}
                  className="flex-1 py-4 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 active:scale-95 transition-transform"
                >
                  儲存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center sm:justify-center animate-fade-in" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="w-full sm:w-auto sm:min-w-[350px] bg-surface rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">設定</h3>
             
             {/* Auto Save Banner */}
             <div className="bg-blue-50 rounded-2xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-2">
                    <i className="ph ph-check-circle text-blue-600 text-xl" />
                    <span className="font-bold text-blue-800">自動儲存已啟用</span>
                </div>
                <p className="text-xs text-blue-600/80 leading-relaxed">
                    您的資料會自動儲存在此裝置瀏覽器中。即使關閉視窗，下次開啟時資料也會自動載入。
                </p>
             </div>

             <div className="space-y-3">
                 <button onClick={handleBackup} className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                            <i className="ph ph-download-simple text-2xl"/>
                        </div>
                        <div className="text-left">
                            <div className="font-bold text-gray-800">下載本機備份</div>
                            <div className="text-xs text-gray-500">下載 JSON 檔案</div>
                        </div>
                    </div>
                    <i className="ph ph-caret-right text-gray-300"/>
                 </button>

                 <button onClick={handleExportCSV} className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
                            <i className="ph ph-file-csv text-2xl"/>
                        </div>
                        <div className="text-left">
                            <div className="font-bold text-gray-800">匯出帳務記錄</div>
                            <div className="text-xs text-gray-500">下載 CSV 檔案</div>
                        </div>
                    </div>
                    <i className="ph ph-caret-right text-gray-300"/>
                 </button>

                 <button onClick={handleImportTrigger} className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center">
                            <i className="ph ph-file-csv text-2xl"/>
                        </div>
                        <div className="text-left">
                            <div className="font-bold text-gray-800">匯入帳務記錄</div>
                            <div className="text-xs text-gray-500">上傳 CSV 檔案</div>
                        </div>
                    </div>
                    <i className="ph ph-upload-simple text-gray-300"/>
                 </button>

                 <button onClick={handleResetData} className="w-full bg-red-50 rounded-2xl p-4 mt-6 flex items-center justify-between active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-white text-danger flex items-center justify-center">
                            <i className="ph ph-trash text-2xl"/>
                        </div>
                        <div className="text-left">
                            <div className="font-bold text-danger">重置記錄</div>
                            <div className="text-xs text-red-400">清除所有資料</div>
                        </div>
                    </div>
                    <i className="ph ph-warning text-danger"/>
                 </button>
             </div>

             <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500 font-bold uppercase mb-3 text-center">介面風格</p>
                <div className="flex gap-4 justify-center">
                  <button onClick={() => setCurrentTheme('default')} className="flex flex-col items-center gap-2"><div className={`w-10 h-10 rounded-full bg-[#F2F2F7] border-2 shadow-sm ${currentTheme === 'default' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}></div></button>
                  <button onClick={() => setCurrentTheme('purple')} className="flex flex-col items-center gap-2"><div className={`w-10 h-10 rounded-full bg-[#5F6094] border-2 shadow-sm ${currentTheme === 'purple' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}></div></button>
                  <button onClick={() => setCurrentTheme('coffee')} className="flex flex-col items-center gap-2"><div className={`w-10 h-10 rounded-full bg-[#C1A994] border-2 shadow-sm ${currentTheme === 'coffee' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}></div></button>
                  <button onClick={() => setCurrentTheme('green')} className="flex flex-col items-center gap-2"><div className={`w-10 h-10 rounded-full bg-[#677D6A] border-2 shadow-sm ${currentTheme === 'green' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}></div></button>
                </div>
             </div>
             
             <button onClick={() => setIsSettingsModalOpen(false)} className="mt-6 w-full py-3 text-gray-500 font-medium rounded-xl hover:bg-gray-100">關閉</button>
          </div>
        </div>
      )}

      {isResetConfirmOpen && <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setIsResetConfirmOpen(false)}><div className="bg-surface w-full max-w-sm rounded-3xl p-6" onClick={e=>e.stopPropagation()}><h3 className="text-xl font-bold mb-2">確定重置？</h3><p className="text-gray-500 mb-6">資料將無法復原。</p><div className="flex gap-3"><button onClick={()=>setIsResetConfirmOpen(false)} className="flex-1 py-3 bg-gray-100 rounded-xl">取消</button><button onClick={executeReset} className="flex-1 py-3 bg-danger text-white rounded-xl">確認</button></div></div></div>}
      
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} onAddClick={() => setIsAddMenuOpen(true)} currentTheme={currentTheme} />
    </div>
  );
}
