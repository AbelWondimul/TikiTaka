'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import { Extension } from '@tiptap/core'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Minus,
  RemoveFormatting,
} from 'lucide-react'

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => el.style.fontSize?.replace(/['"]+/g, ''),
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}
        }
      }
    }]
  }
})

export default function RichTextEditor({
  content,
  onUpdate,
  placeholder,
  minHeight = '150px',
  className = '',
  simpleMode = false,
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      if (onUpdate) {
        onUpdate(editor.getJSON())
      }
    },
    editorProps: {
      attributes: {
        class: `min-h-[${minHeight}] p-3 prose prose-sm max-w-none focus:outline-none`,
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
  })

  if (!editor) return null

  const ToolbarButton = ({ onClick, active, children, title }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-8 w-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-sm ${
        active ? 'bg-primary/10 text-primary' : ''
      }`}
    >
      {children}
    </button>
  )

  const Separator = () => (
    <div className="w-px h-6 bg-border mx-1" />
  )

  const renderToolbar = () => {
    if (simpleMode) {
      return (
        <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/30 rounded-t-lg">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')}
            title="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            title="Ordered List"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )
    }

    return (
      <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/30 rounded-t-lg">
        {/* Font Family */}
        <select
          className="h-8 text-xs border rounded px-1.5 bg-background"
          value={editor.getAttributes('textStyle').fontFamily || ''}
          onChange={(e) => {
            if (e.target.value) {
              editor.chain().focus().setFontFamily(e.target.value).run()
            } else {
              editor.chain().focus().unsetFontFamily().run()
            }
          }}
        >
          <option value="">Font</option>
          <option value="Inter">Inter</option>
          <option value="Georgia">Georgia</option>
          <option value="Courier New">Courier New</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Verdana">Verdana</option>
        </select>

        {/* Font Size */}
        <select
          className="h-8 text-xs border rounded px-1.5 bg-background"
          value={editor.getAttributes('textStyle').fontSize?.replace('px', '') || ''}
          onChange={(e) => {
            if (e.target.value) {
              editor.chain().focus().setMark('textStyle', { fontSize: `${e.target.value}px` }).run()
            } else {
              editor.chain().focus().unsetMark('textStyle').run()
            }
          }}
        >
          <option value="">Size</option>
          {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>

        <Separator />

        {/* Bold */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <span className="font-bold">B</span>
        </ToolbarButton>

        {/* Italic */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <span className="italic">I</span>
        </ToolbarButton>

        {/* Underline */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
        >
          <span className="underline">U</span>
        </ToolbarButton>

        {/* Strikethrough */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <span className="line-through">S</span>
        </ToolbarButton>

        <Separator />

        {/* Text Color */}
        <input
          type="color"
          className="h-8 w-8 rounded cursor-pointer border-0 p-0.5"
          title="Text Color"
          value={editor.getAttributes('textStyle').color || '#000000'}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />

        {/* Highlight Color */}
        <input
          type="color"
          className="h-8 w-8 rounded cursor-pointer border-0 p-0.5"
          title="Highlight Color"
          value={editor.getAttributes('highlight').color || '#ffff00'}
          onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
        />

        <Separator />

        {/* Text Align */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          title="Align Center"
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          active={editor.isActive({ textAlign: 'justify' })}
          title="Justify"
        >
          <AlignJustify className="h-4 w-4" />
        </ToolbarButton>

        <Separator />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Ordered List"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>

        <Separator />

        {/* Horizontal Rule */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus className="h-4 w-4" />
        </ToolbarButton>

        {/* Clear Formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Clear Formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </ToolbarButton>
      </div>
    )
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      {renderToolbar()}
      <EditorContent editor={editor} />
    </div>
  )
}
