// SPDX-License-Identifier: Apache-2.0
import { inject, type InjectionKey } from 'vue'
import type { Editor } from './useEditor'

export const EditorKey: InjectionKey<Editor> = Symbol('photo-ai-editor')

export function useEditorContext(): Editor {
  const editor = inject(EditorKey)
  if (!editor) throw new Error('editor context is missing')
  return editor
}
