import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'cta' | 'secondary' | 'ghost' | 'danger' | 'urgent';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children: ReactNode;
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  type = 'button',
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) => {
  const classes = [
    'oa-btn',
    `oa-btn--${variant}`,
    `oa-btn--${size}`,
    isLoading ? 'oa-btn--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading && <span className="oa-btn__spinner" aria-hidden="true" />}
      <span className="oa-btn__label">{children}</span>
    </button>
  );
};
