/**
 * In-app confirm dialog: replaces the browser confirm API, which behaves via
 * native modal on the web but is part of the same browser-dialog family that
 * differs across the DSH Desktop (Electron) client. Same look and interaction
 * as the other tree dialogs.
 */
import { useEffect, useRef } from 'react'
import s from './styles.module.css'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // Focus the primary action; Escape anywhere cancels (the button keeps focus).
  useEffect(() => {
    confirmRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className={s.overlay} onClick={onCancel}>
      <div className={s.dialog} onClick={(event) => event.stopPropagation()}>
        <div className={s.dialogTitle}>{title}</div>
        <div className={s.dialogBody}>{message}</div>
        <div className={s.dialogFooter}>
          <button className={s.button} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} className={`${s.button} ${s.buttonPrimary}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
