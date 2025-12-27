
import React from 'react';

interface TabNavProps {
  activeTab: 'dashboard' | 'transactions' | 'accounts' | 'charts';
  onTabChange: (tab: 'dashboard' | 'transactions' | 'accounts' | 'charts') => void;
  onAddClick: () => void;
  currentTheme?: 'default' | 'purple' | 'coffee' | 'green';
}

export const TabNav: React.FC<TabNavProps> = ({ activeTab, onTabChange, onAddClick, currentTheme = 'default' }) => {
  const isDefault = currentTheme === 'default';

  // Styles based on theme
  // Default: White background, Gray/Primary icons
  // Themed: Primary (Dark) background, White/Transparent icons
  const containerStyle = isDefault 
    ? "bg-surface/90 border-gray-200" 
    : "bg-primary/95 border-white/10 shadow-[0_-5px_15px_rgba(0,0,0,0.1)]";

  const activeIconClass = isDefault 
    ? "text-primary scale-110 font-bold" 
    : "text-white scale-110 drop-shadow-md font-bold";

  const inactiveIconClass = isDefault 
    ? "text-gray-400 hover:text-gray-600" 
    : "text-white/50 hover:text-white/80";

  // Center Button: 
  // Default -> Primary Bg, White Icon
  // Themed -> White Bg, Primary Icon (High Contrast)
  const centerBtnBg = isDefault 
    ? "bg-primary text-white shadow-primary/40" 
    : "bg-white text-primary shadow-black/20";

  const labelClass = isDefault ? "text-gray-500" : "text-white/70";
  const activeLabelClass = isDefault ? "text-primary" : "text-white";

  const getTabClass = (tab: string) => {
    const isActive = activeTab === tab;
    return `flex flex-col items-center justify-center pb-1 transition-all duration-300 ${isActive ? activeIconClass : inactiveIconClass}`;
  };

  const getLabelClass = (tab: string) => {
    const isActive = activeTab === tab;
    return `text-[9px] font-medium mt-0.5 transition-colors ${isActive ? activeLabelClass : (isDefault ? 'text-gray-400' : 'text-white/50')}`;
  };

  return (
    <div className={`fixed bottom-0 left-0 right-0 backdrop-blur-lg border-t pb-safe-bottom z-50 transition-colors duration-500 ${containerStyle}`}>
      <div className="grid grid-cols-5 items-end h-16 pb-2">
        {/* Dashboard */}
        <button 
          onClick={() => onTabChange('dashboard')}
          className={getTabClass('dashboard')}
        >
          <i className={`ph ${activeTab === 'dashboard' ? 'ph-money-fill' : 'ph-money'} text-2xl`} />
          <span className={getLabelClass('dashboard')}>總覽</span>
        </button>

        {/* Accounts */}
        <button 
          onClick={() => onTabChange('accounts')}
          className={getTabClass('accounts')}
        >
          <i className={`ph ${activeTab === 'accounts' ? 'ph-wallet-fill' : 'ph-wallet'} text-2xl`} />
          <span className={getLabelClass('accounts')}>帳戶餘額</span>
        </button>

        {/* Add Record (Center) */}
        <div className="relative flex flex-col items-center justify-end h-full pb-1 group">
          <button 
            onClick={onAddClick}
            className={`absolute -top-6 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform duration-300 active:scale-95 group-hover:scale-105 ${centerBtnBg}`}
          >
             <i className="ph ph-plus text-3xl font-bold" />
          </button>
          <span className={`text-[9px] font-medium transition-colors ${labelClass}`}>新增記錄</span>
        </div>

        {/* Charts */}
        <button 
          onClick={() => onTabChange('charts')}
          className={getTabClass('charts')}
        >
          <i className={`ph ${activeTab === 'charts' ? 'ph-chart-pie-slice-fill' : 'ph-chart-pie-slice'} text-2xl`} />
          <span className={getLabelClass('charts')}>分析圖表</span>
        </button>

        {/* History */}
        <button 
          onClick={() => onTabChange('transactions')}
          className={getTabClass('transactions')}
        >
          <i className={`ph ${activeTab === 'transactions' ? 'ph-list-dashes-fill' : 'ph-list-dashes'} text-2xl`} />
          <span className={getLabelClass('transactions')}>帳務記錄</span>
        </button>
      </div>
    </div>
  );
};
