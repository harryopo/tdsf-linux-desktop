/**
 * Toast — TRAE 提示消息（基于 Radix Toast）
 *
 * 组成：ToastProvider / Toast / ToastTitle / ToastDescription / ToastClose / ToastViewport
 *
 * 设计要点：
 * - 右下角弹出
 * - 背景 var(--trae-bg-base-tertiary)
 * - 圆角 var(--trae-radius-6)
 * - 4 种类型：default / success / warning / error
 */
import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from './utils'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[400px]',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] p-4 pr-8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'text-[var(--trae-text-default)]',
        success: 'border-l-2 border-l-[var(--trae-status-success-default)]',
        warning: 'border-l-2 border-l-[var(--trae-status-alert-default)]',
        error: 'border-l-2 border-l-[var(--trae-status-error-default)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
))
Toast.displayName = ToastPrimitives.Root.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 rounded-[var(--trae-radius-2)] text-[var(--trae-text-tertiary)] opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="size-3.5" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-[13px] font-medium text-[var(--trae-text-default)]', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-[12px] text-[var(--trae-text-secondary)]', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
}
