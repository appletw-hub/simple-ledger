
import { Account, CategoryOption } from './types';

export const INITIAL_ACCOUNTS: Account[] = [
  { id: 'acc_1', name: '現金錢包', type: 'CASH', initialBalance: 2000, color: 'bg-orange-500' },
  { id: 'acc_2', name: '銀行帳戶', type: 'BANK', initialBalance: 150000, color: 'bg-blue-500' },
  { id: 'acc_3', name: '信用卡', type: 'CREDIT', initialBalance: -5000, color: 'bg-purple-500' },
];

export const PRESET_BANKS = ['LINE Bank', '台新銀行', '元大銀行', '台灣銀行', '台北富邦', '郵局'];

export const EXPENSE_CATEGORIES: CategoryOption[] = [
  { id: 'cat_food', name: '餐飲', icon: 'fork-knife', type: 'EXPENSE' },
  { id: 'cat_transport', name: '交通', icon: 'car', type: 'EXPENSE' },
  { id: 'cat_shopping', name: '購物', icon: 'shopping-bag', type: 'EXPENSE' },
  { id: 'cat_bills', name: '帳單', icon: 'receipt', type: 'EXPENSE' },
  { id: 'cat_entertainment', name: '娛樂', icon: 'film-strip', type: 'EXPENSE' },
  { id: 'cat_health', name: '醫療保健', icon: 'first-aid', type: 'EXPENSE' },
  { id: 'cat_education', name: '教育', icon: 'graduation-cap', type: 'EXPENSE' },
  { id: 'cat_travel', name: '旅行', icon: 'airplane-tilt', type: 'EXPENSE' },
  { id: 'cat_other_exp', name: '其他', icon: 'dots-three', type: 'EXPENSE' },
];

export const INCOME_CATEGORIES: CategoryOption[] = [
  { id: 'cat_salary', name: '薪資', icon: 'money', type: 'INCOME' },
  { id: 'cat_investment', name: '投資', icon: 'chart-line-up', type: 'INCOME' },
  { id: 'cat_gift', name: '禮金', icon: 'gift', type: 'INCOME' },
  { id: 'cat_other_inc', name: '其他', icon: 'dots-three', type: 'INCOME' },
];

export const TRANSFER_CATEGORY = { id: 'cat_transfer', name: '轉帳', icon: 'arrows-left-right', type: 'TRANSFER' };
