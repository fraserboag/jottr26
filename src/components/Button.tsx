import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  asChild?: boolean
}

function Button({
  className,
  variant = 'primary',
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(' ')

  return <Comp className={classes} {...props} />
}

export { Button }
export type { ButtonProps, ButtonVariant }
