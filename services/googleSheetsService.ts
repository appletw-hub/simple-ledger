import { Transaction, Account, TransactionType } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TRANSFER_CATEGORY } from '../constants';

const SPREADSHEET_NAME = "SmartLedger_AutoBackup";
// Request scopes for both Spreadsheets and Drive (to find files)
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// Initialize gapi client
export const initializeGoogleApi = async () => {
  return new Promise<void>((resolve) => {
    (window as any).gapi.load('client', async () => {
      await (window as any).gapi.client.init({
        // Include Drive API discovery doc for file search
        discoveryDocs: [
            'https://sheets.googleapis.com/$discovery/rest?version=v4',
            'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
        ],
      });
      gapiInited = true;
      resolve();
    });
  });
};

// Initialize Google Identity Services
export const initializeGoogleIdentity = (clientId: string, callback: (response: any) => void) => {
  tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp: any) => {
      if (resp.error !== undefined) {
        throw (resp);
      }
      callback(resp);
    },
  });
  gisInited = true;
};

export const requestAccessToken = () => {
  if (!tokenClient) return;
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

// --- Sync Logic ---

const getCategoryName = (catId: string) => {
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
  return all.find(c => c.id === catId)?.name || catId;
};

const getCategoryIdByName = (name: string, type: string) => {
    const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, TRANSFER_CATEGORY];
    // Exact match
    const exact = all.find(c => c.name === name);
    if (exact) return exact.id;
    
    // Fallback based on type
    if (type === 'INCOME') return 'cat_other_inc';
    if (type === 'TRANSFER') return 'cat_transfer';
    return 'cat_other_exp';
};

const getAccountName = (accId: string, accounts: Account[]) => {
    return accounts.find(a => a.id === accId)?.name || accId;
};

export const syncDataToGoogleSheets = async (transactions: Transaction[], accounts: Account[]) => {
  if (!gapiInited) throw new Error("Google API not initialized");

  try {
    // 1. Find or Create Spreadsheet
    let spreadsheetId = await findSpreadsheetId();
    if (!spreadsheetId) {
      spreadsheetId = await createSpreadsheet();
    }

    // 2. Fetch Spreadsheet Metadata (to check existing sheets)
    const meta = await (window as any).gapi.client.sheets.spreadsheets.get({
        spreadsheetId
    });
    const existingSheets = new Set(meta.result.sheets.map((s: any) => s.properties.title));

    // 3. Group Transactions by Month (YYYY-MM)
    const groupedData: Record<string, Transaction[]> = {};
    transactions.forEach(tx => {
      const monthKey = tx.date.slice(0, 7); // "2024-05"
      if (!groupedData[monthKey]) groupedData[monthKey] = [];
      groupedData[monthKey].push(tx);
    });

    // 4. Batch Create Missing Sheets
    const createSheetRequests: any[] = [];
    Object.keys(groupedData).forEach(month => {
        if (!existingSheets.has(month)) {
            createSheetRequests.push({ addSheet: { properties: { title: month } } });
        }
    });

    if (createSheetRequests.length > 0) {
        await (window as any).gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: createSheetRequests }
        });
    }

    // 5. Prepare Batch Update Data
    const dataToUpdate: any[] = [];
    const rangesToClear: string[] = [];

    for (const [month, monthTxs] of Object.entries(groupedData)) {
        const headers = ['日期', '類型', '金額', '分類', '備註', '地點', '帳戶', '轉入帳戶'];
        const rows = monthTxs
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Newest first
            .map(tx => [
                tx.date,
                tx.type === 'INCOME' ? '收入' : tx.type === 'EXPENSE' ? '支出' : '轉帳',
                tx.amount,
                getCategoryName(tx.category),
                tx.description,
                tx.location || '',
                getAccountName(tx.accountId, accounts),
                tx.toAccountId ? getAccountName(tx.toAccountId, accounts) : ''
            ]);
        
        const values = [headers, ...rows];
        
        // We clear columns A to H for the target month sheet to ensure no leftover rows
        rangesToClear.push(`'${month}'!A:H`);
        
        dataToUpdate.push({
            range: `'${month}'!A1`,
            values: values
        });
    }

    // 6. Execute Batch Clear (Efficiently clear old data)
    if (rangesToClear.length > 0) {
        await (window as any).gapi.client.sheets.spreadsheets.values.batchClear({
            spreadsheetId,
            resource: { ranges: rangesToClear }
        });
    }

    // 7. Execute Batch Update (Efficiently write new data)
    if (dataToUpdate.length > 0) {
        await (window as any).gapi.client.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: dataToUpdate
            }
        });
    }
    
    return true;
  } catch (error) {
    console.error("Sync failed:", error);
    throw error;
  }
};

export const restoreDataFromGoogleSheets = async () => {
    if (!gapiInited) throw new Error("Google API not initialized");

    try {
        const spreadsheetId = await findSpreadsheetId();
        if (!spreadsheetId) {
            throw new Error("找不到備份檔案 (SmartLedger_AutoBackup)");
        }

        // 1. Get all sheets
        const meta = await (window as any).gapi.client.sheets.spreadsheets.get({
            spreadsheetId
        });
        const sheets = meta.result.sheets;
        
        if (!sheets || sheets.length === 0) return { transactions: [], accountNames: new Set<string>() };

        // 2. Batch Get Values from all sheets
        // ranges: ['2023-01!A2:H', '2023-02!A2:H', ...]
        const ranges = sheets.map((s: any) => `'${s.properties.title}'!A2:H`);
        
        const response = await (window as any).gapi.client.sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges
        });

        const valueRanges = response.result.valueRanges;
        
        const transactions: Transaction[] = [];
        const accountNames = new Set<string>();

        valueRanges.forEach((range: any) => {
            if (range.values) {
                range.values.forEach((row: any[]) => {
                    // Row format: [Date, Type, Amount, CategoryName, Desc, Location, AccountName, ToAccountName]
                    if (row.length < 3) return; // Skip empty/invalid

                    const date = row[0];
                    const typeLabel = row[1];
                    const amount = parseFloat(String(row[2]).replace(/,/g, ''));
                    const categoryName = row[3];
                    const description = row[4] || '';
                    const location = row[5] || '';
                    const accountName = row[6] || '';
                    const toAccountName = row[7] || '';

                    // Convert Type
                    let type: TransactionType = 'EXPENSE';
                    if (typeLabel === '收入') type = 'INCOME';
                    else if (typeLabel === '轉帳' || typeLabel === '轉出' || typeLabel === '轉入') type = 'TRANSFER';

                    // Collect Account Names for later reconciliation
                    if (accountName) accountNames.add(accountName);
                    if (toAccountName) accountNames.add(toAccountName);

                    // Reconstruct ID (random)
                    const id = `restored_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    transactions.push({
                        id,
                        date,
                        type,
                        amount: isNaN(amount) ? 0 : amount,
                        category: getCategoryIdByName(categoryName, type),
                        description,
                        location,
                        accountId: accountName, // Temporary: Store Name, will replace with ID in App.tsx
                        toAccountId: toAccountName // Temporary: Store Name
                    });
                });
            }
        });

        return { transactions, accountNames };

    } catch (error) {
        console.error("Restore failed:", error);
        throw error;
    }
};

const findSpreadsheetId = async (): Promise<string | null> => {
  try {
    // Robust search using Drive API
    // Finds file with exact name, is a spreadsheet, and is NOT in trash
    const response = await (window as any).gapi.client.drive.files.list({
      q: `name = '${SPREADSHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    
    const files = response.result.files;
    if (files && files.length > 0) {
        const id = files[0].id;
        localStorage.setItem('smartledger_spreadsheet_id', id);
        return id;
    }
    return null;
  } catch (e) {
    console.warn("Drive search failed, falling back to local storage", e);
    return localStorage.getItem('smartledger_spreadsheet_id');
  }
};

const createSpreadsheet = async (): Promise<string> => {
  const response = await (window as any).gapi.client.sheets.spreadsheets.create({
    properties: {
      title: SPREADSHEET_NAME,
    },
  });
  const id = response.result.spreadsheetId;
  localStorage.setItem('smartledger_spreadsheet_id', id);
  return id;
};