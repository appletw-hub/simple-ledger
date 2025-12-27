import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  className = '', 
  isLoading = false,
  icon,
  ...props 
}) => {
  const baseStyles = "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:scale-100";
  
  const variants = {
    primary: "bg-primary text-white shadow-lg shadow-primary/30",
    secondary: "bg-white text-gray-800 shadow-sm border border-gray-200",
    danger: "bg-danger text-white shadow-lg shadow-danger/30",
    ghost: "bg-transparent text-gray-500 hover:bg-gray-100"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          {icon && <span>{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
};