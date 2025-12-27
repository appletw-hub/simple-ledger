
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'BI_MONTHLY_ODD' | 'BI_MONTHLY_EVEN' | 'YEARLY';

export interface Account {
  id: string;
  name: string;
  type: 'CASH' | 'BANK' | 'CREDIT' | 'E-WALLET' | 'OTHER';
  initialBalance: number;
  color: string;
}

export interface Transaction {
  id: string;
  date: string; // ISO string YYYY-MM-DD
  amount: number;
  type: TransactionType;
  category: string;
  description: string;
  location?: string; // New field
  accountId: string; // From Account (Expense/Transfer) or To Account (Income)
  toAccountId?: string; // For Transfer only
  receiptImage?: string; // Base64
  isRecurringInstance?: boolean; // Identifies if this was auto-generated
}

export interface RecurringTransaction {
  id: string;
  frequency: Frequency;
  startDate: string;
  nextDueDate: string;
  endDate?: string; // Optional
  lastGenerated?: string;
  // Template data
  amount: number;
  type: TransactionType;
  category: string;
  description: string;
  location?: string; // New field
  accountId: string;
  toAccountId?: string;
}

export interface ReceiptData {
  date: string;
  amount: number;
  description: string;
  category: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  icon: string;
  type: 'INCOME' | 'EXPENSE';
}