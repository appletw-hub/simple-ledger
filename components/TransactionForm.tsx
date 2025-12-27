import React, { useState, useEffect } from 'react';
import { Account, CategoryOption, ReceiptData, TransactionType, Frequency, Transaction } from '../types';
import { Button } from './Button';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants';
import { analyzeReceipt } from '../services/geminiService';

interface TransactionFormProps {
  accounts: Account[];
  accountBalances: Record<string, number>;
  initialData?: Partial<Transaction> | null;
  receiptImage?: string | null;
  onClose: () => void;
  onSubmit: (data: any, isDuplicate?: boolean) => void;
  onDelete?: () => void;
}

export const TransactionForm: React.FC<TransactionFormProps> = ({
  accounts,
  accountBalances,
  initialData,
  receiptImage,
  onClose,
  onSubmit,
  onDelete
}) => {
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [category, setCategory] = useState<string>('cat_food');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState<string>(accounts.length > 1 ? accounts[1].id : '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Transfer Sub-Type State: INTERNAL (Own Accounts), OUT (Expense), IN (Income)
  const [transferSubType, setTransferSubType] = useState<'INTERNAL' | 'OUT' | 'IN'>('INTERNAL');

  // Recurring State
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [endDate, setEndDate] = useState<string>('');

  // Effect to prevent Transfer Source == Destination
  useEffect(() => {
    if (type === 'TRANSFER' && transferSubType === 'INTERNAL' && accountId === toAccountId) {
      const otherAccount = accounts.find(acc => acc.id !== accountId);
      if (otherAccount) {
        setToAccountId(otherAccount.id);
      }
    }
  }, [type, transferSubType, accountId, toAccountId, accounts]);

  useEffect(() => {
    if (initialData) {
      // Check specifically for undefined to allow 0
      if (initialData.amount !== undefined) setAmount(Math.round(initialData.amount).toString());
      if (initialData.date) setDate(initialData.date);
      if (initialData.description) setDescription(initialData.description);
      if (initialData.location) setLocation(initialData.location);
      if (initialData.type) {
          // Logic to determine Transfer SubType based on loaded data
          if (initialData.type === 'EXPENSE' && initialData.category === 'cat_transfer') {
              setType('TRANSFER');
              setTransferSubType('OUT');
          } else if (initialData.type === 'INCOME' && initialData.category === 'cat_transfer') {
              setType('TRANSFER');
              setTransferSubType('IN');
          } else if (initialData.type === 'TRANSFER') {
              setType('TRANSFER');
              setTransferSubType('INTERNAL');
          } else {
              setType(initialData.type);
          }
      }
      if (initialData.accountId) setAccountId(initialData.accountId);
      if (initialData.toAccountId) setToAccountId(initialData.toAccountId);
      
      // Category handling
      if (initialData.category && initialData.category !== 'cat_transfer') {
        // Check if it's a known ID first
        const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
        const exactMatch = allCats.find(c => c.id === initialData.category);
        
        if (exactMatch) {
            setCategory(exactMatch.id);
        } else {
            // Try heuristic match for AI results
            const found = allCats.find(c => c.id.includes(initialData.category!.toLowerCase()) || c.name.includes(initialData.category!));
            if (found) setCategory(found.id);
        }
      }
    }
  }, [initialData]);

  // Auto-analyze if image provided but no data yet (safeguard)
  useEffect(() => {
    const analyze = async () => {
      // Only analyze if we have an image AND we aren't editing an existing transaction (no ID)
      // If initialData has an ID, it means we are editing, so don't re-analyze image.
      if (receiptImage && (!initialData || !initialData.id) && !isAnalyzing && !amount) {
        setIsAnalyzing(true);
        try {
          const data = await analyzeReceipt(receiptImage);
          setAmount(Math.round(data.amount).toString());
          setDate(data.date);
          setDescription(data.description);
          // Category match logic - Duplicate logic from App.tsx to ensure form state is correct
          let foundId = 'cat_other_exp';
          const aiCat = data.category.toLowerCase();
          if (aiCat.includes('food') || aiCat.includes('restaurant') || aiCat.includes('dining') || aiCat.includes('meal') || aiCat.includes('drink')) foundId = 'cat_food';
          else if (aiCat.includes('transport') || aiCat.includes('gas') || aiCat.includes('uber') || aiCat.includes('taxi') || aiCat.includes('bus')) foundId = 'cat_transport';
          else if (aiCat.includes('shopping') || aiCat.includes('retail') || aiCat.includes('clothing') || aiCat.includes('store')) foundId = 'cat_shopping';
          else if (aiCat.includes('bill') || aiCat.includes('utility') || aiCat.includes('electric') || aiCat.includes('water') || aiCat.includes('internet')) foundId = 'cat_bills';
          else if (aiCat.includes('movie') || aiCat.includes('entertainment') || aiCat.includes('game') || aiCat.includes('cinema')) foundId = 'cat_entertainment';
          else if (aiCat.includes('health') || aiCat.includes('medical') || aiCat.includes('doctor') || aiCat.includes('pharmacy') || aiCat.includes('drug')) foundId = 'cat_health';
          else if (aiCat.includes('education') || aiCat.includes('school') || aiCat.includes('tuition') || aiCat.includes('book') || aiCat.includes('course')) foundId = 'cat_education';
          else if (aiCat.includes('travel') || aiCat.includes('flight') || aiCat.includes('hotel') || aiCat.includes('trip') || aiCat.includes('airbnb')) foundId = 'cat_travel';
          
          setCategory(foundId);
          // Force type to Expense for receipts
          setType('EXPENSE');
        } catch (e) {
          console.error(e);
        } finally {
          setIsAnalyzing(false);
        }
      }
    };
    analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptImage, initialData]);

  const handleSubmit = (e: React.FormEvent, isDuplicate: boolean = false) => {
    if (e) e.preventDefault();

    let finalType: TransactionType = type;
    let finalCategory = category;
    let finalToAccount = undefined;

    if (type === 'TRANSFER') {
        if (transferSubType === 'INTERNAL') {
            finalType = 'TRANSFER';
            finalCategory = 'cat_transfer';
            finalToAccount = toAccountId;
        } else if (transferSubType === 'OUT') {
            finalType = 'EXPENSE';
            finalCategory = 'cat_transfer';
        } else if (transferSubType === 'IN') {
            finalType = 'INCOME';
            finalCategory = 'cat_transfer';
        }
    }

    onSubmit({
      type: finalType,
      amount: Math.round(parseFloat(amount) || 0), // Ensure integer and valid number
      date,
      description,
      location,
      category: finalCategory,
      accountId,
      toAccountId: finalToAccount,
      receiptImage,
      // Recurring Data
      isRecurring,
      frequency: isRecurring ? frequency : undefined,
      endDate: isRecurring && endDate ? endDate : undefined,
    }, isDuplicate);
  };

  const handleDuplicate = (e: React.MouseEvent) => {
      e.preventDefault();
      handleSubmit(e as any, true);
  };

  const setToday = () => {
    setDate(new Date().toISOString().split('T')[0]);
  }

  const activeCategories = type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const getBalanceDisplay = (id: string) => {
    const bal = accountBalances[id] || 0;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(bal);
  };

  const currentAccountBalance = accountBalances[accountId] || 0;
  const toAccountBalance = accountBalances[toAccountId] || 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-slide-up">
      {/* Header */}
      <div className="px-4 py-3 bg-surface flex items-center justify-between border-b">
        <button onClick={onClose} className="text-primary text-lg">取消</button>
        <h2 className="font-semibold text-lg">{initialData?.id ? '編輯紀錄' : '新增紀錄'}</h2>
        <div className="w-12"></div> 
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {receiptImage && (
          <div className="mb-6 flex justify-center">
             <img src={receiptImage} alt="Receipt" className="h-48 object-cover rounded-xl shadow-md" />
          </div>
        )}

        {isAnalyzing && (
          <div className="mb-6 p-4 bg-blue-50 text-blue-600 rounded-xl flex items-center gap-3">
             <i className="ph ph-magic-wand animate-pulse text-xl" />
             <span>AI 正在辨識收據...</span>
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6">
          {/* Type Selector */}
          <div className="bg-surface p-1 rounded-xl flex shadow-sm">
            <button
              type="button"
              onClick={() => { setType('EXPENSE'); setCategory(EXPENSE_CATEGORIES[0].id); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                type === 'EXPENSE' ? 'bg-green-500 text-white shadow' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              支出
            </button>
            <button
              type="button"
              onClick={() => { setType('INCOME'); setCategory(INCOME_CATEGORIES[0].id); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                type === 'INCOME' ? 'bg-yellow-500 text-white shadow' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              收入
            </button>
            <button
              type="button"
              onClick={() => { setType('TRANSFER'); setCategory(EXPENSE_CATEGORIES[0].id); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                type === 'TRANSFER' ? 'bg-primary text-white shadow' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              轉帳
            </button>
          </div>

          {/* Transfer Sub-Type Selector */}
          {type === 'TRANSFER' && (
            <div className="bg-gray-100 p-1 rounded-xl flex">
               <button
                type="button"
                onClick={() => setTransferSubType('OUT')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 ${
                  transferSubType === 'OUT' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                <i className="ph ph-arrow-up-right" /> 轉出
              </button>
              <button
                type="button"
                onClick={() => setTransferSubType('INTERNAL')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 ${
                  transferSubType === 'INTERNAL' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
                }`}
              >
                <i className="ph ph-arrows-left-right" /> 互轉
              </button>
              <button
                type="button"
                onClick={() => setTransferSubType('IN')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 ${
                  transferSubType === 'IN' ? 'bg-white text-yellow-600 shadow-sm' : 'text-gray-500'
                }`}
              >
                <i className="ph ph-arrow-down-left" /> 轉入
              </button>
            </div>
          )}

          {/* Amount */}
          <div className="bg-surface rounded-xl p-4 shadow-sm">
            <label className="text-xs text-gray-500 font-medium uppercase">金額</label>
            <div className="flex items-center mt-1">
              <span className={`text-2xl font-bold mr-2 ${
                  (type === 'EXPENSE' || (type === 'TRANSFER' && transferSubType !== 'IN')) ? 'text-green-500' : 
                  (type === 'INCOME' || (type === 'TRANSFER' && transferSubType === 'IN')) ? 'text-yellow-500' : 'text-primary'
              }`}>
                {(type === 'EXPENSE' || (type === 'TRANSFER' && transferSubType === 'OUT')) ? '-' : ''}$
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={`w-full text-3xl font-bold bg-transparent outline-none placeholder-gray-300 ${
                  (type === 'EXPENSE' || (type === 'TRANSFER' && transferSubType !== 'IN')) ? 'text-green-500' : 
                  (type === 'INCOME' || (type === 'TRANSFER' && transferSubType === 'IN')) ? 'text-yellow-500' : 'text-primary'
                }`}
              />
            </div>
          </div>

          {/* Accounts */}
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-surface rounded-xl p-4 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs text-gray-500 font-medium uppercase block">
                  {type === 'INCOME' || (type === 'TRANSFER' && transferSubType === 'IN') ? '存入帳戶' : '支付帳戶'}
                </label>
                <span className={`text-xs font-bold ${currentAccountBalance < 0 ? 'text-danger' : 'text-primary'}`}>
                  目前餘額: ${getBalanceDisplay(accountId)}
                </span>
              </div>
              <select 
                value={accountId} 
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full bg-transparent text-lg outline-none"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name} (${getBalanceDisplay(acc.id)})</option>
                ))}
              </select>
            </div>

            {type === 'TRANSFER' && transferSubType === 'INTERNAL' && (
              <div className="bg-surface rounded-xl p-4 shadow-sm animate-fade-in">
                 <div className="flex justify-between items-center mb-2">
                  <label className="text-xs text-gray-500 font-medium uppercase block">
                    轉入帳戶
                  </label>
                  <span className={`text-xs font-bold ${toAccountBalance < 0 ? 'text-danger' : 'text-primary'}`}>
                    目前餘額: ${getBalanceDisplay(toAccountId)}
                  </span>
                </div>
                <select 
                  value={toAccountId} 
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full bg-transparent text-lg outline-none"
                >
                   {accounts.filter(acc => acc.id !== accountId).map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name} (${getBalanceDisplay(acc.id)})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Details: Date, Description, Location */}
          <div className="bg-surface rounded-xl p-4 shadow-sm space-y-4">
            
            {/* Date Selection - Calendar Mode */}
            <div>
              <div className="flex justify-between items-center mb-2">
                 <label className="text-xs text-gray-500 font-medium uppercase block">日期</label>
                 <button type="button" onClick={setToday} className="text-[10px] font-bold text-primary bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors">今天</button>
              </div>
              <div className="relative">
                 <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <i className="ph ph-calendar-blank text-xl" />
                 </div>
                 <input 
                  type="date" 
                  required
                  value={date} 
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-gray-50 h-12 pl-10 pr-4 rounded-xl outline-none text-lg font-medium uppercase cursor-pointer hover:bg-gray-100 transition-colors"
                />
              </div>
            </div>

            <div className="h-px bg-gray-100"></div>
            
             {/* Description */}
             <div>
              <label className="text-xs text-gray-500 font-medium uppercase block mb-2">備註</label>
              <div className="relative">
                 <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <i className="ph ph-note-pencil text-xl" />
                 </div>
                 <input 
                    type="text" 
                    value={description} 
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="輸入備註說明..."
                    className="w-full bg-gray-50 h-12 pl-10 pr-4 rounded-xl outline-none text-base transition-colors focus:bg-white focus:ring-2 focus:ring-primary/20"
                  />
              </div>
            </div>

            <div className="h-px bg-gray-100"></div>

            {/* Location */}
            <div>
              <label className="text-xs text-gray-500 font-medium uppercase block mb-2">地點</label>
              <div className="relative">
                 <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <i className="ph ph-map-pin text-xl" />
                 </div>
                 <input 
                    type="text" 
                    value={location} 
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="輸入地點 (選填)"
                    className="w-full bg-gray-50 h-12 pl-10 pr-4 rounded-xl outline-none text-base transition-colors focus:bg-white focus:ring-2 focus:ring-primary/20"
                  />
              </div>
            </div>

          </div>

          {/* Categories */}
          {type !== 'TRANSFER' && (
            <div className="bg-surface rounded-xl p-4 shadow-sm">
              <label className="text-xs text-gray-500 font-medium uppercase block mb-3">分類</label>
              <div className="grid grid-cols-4 gap-3">
                {activeCategories.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                      category === cat.id ? 'bg-primary/10 text-primary ring-2 ring-primary' : 'text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <i className={`ph ph-${cat.icon} text-2xl mb-1`} />
                    <span className="text-[10px] truncate w-full text-center">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recurring Toggle & Options - Always Visible Now */}
          <div className="bg-surface rounded-xl p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-blue-100 p-1.5 rounded-md text-blue-600">
                  <i className="ph ph-arrows-clockwise text-lg" />
                </div>
                <span className="font-medium text-gray-800">週期性項目</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="sr-only peer" 
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {isRecurring && (
              <div className="animate-fade-in space-y-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="text-xs text-gray-500 font-medium uppercase block mb-2">頻率</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                    className="w-full p-2 bg-gray-50 rounded-lg border border-gray-200 outline-none"
                  >
                    <option value="DAILY">每天</option>
                    <option value="WEEKLY">每週</option>
                    <option value="MONTHLY">每月</option>
                    <option value="BI_MONTHLY_ODD">每逢單月 (1,3,5...)</option>
                    <option value="BI_MONTHLY_EVEN">每逢雙月 (2,4,6...)</option>
                    <option value="YEARLY">每年</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium uppercase block mb-2">結束日期 (選填)</label>
                  <input 
                    type="date" 
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full p-2 bg-gray-50 rounded-lg border border-gray-200 outline-none"
                    min={date}
                  />
                </div>
              </div>
            )}
          </div>

          <Button type="submit" className="w-full mt-4 text-lg shadow-xl" disabled={isAnalyzing}>
            {initialData?.id ? '儲存變更' : '新增紀錄'}
          </Button>

          {/* Action Buttons for Edit Mode */}
          {initialData?.id && (
            <div className="flex gap-3 mt-3">
                {onDelete && (
                    <button
                    type="button"
                    onClick={onDelete}
                    className="flex-1 py-3 rounded-xl font-medium text-danger bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                    >
                    <i className="ph ph-trash text-xl" /> 刪除
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleDuplicate}
                    className="flex-1 py-3 rounded-xl font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                >
                    <i className="ph ph-copy text-xl" /> 複製並新增
                </button>
            </div>
          )}

        </form>
      </div>
    </div>
  );
};