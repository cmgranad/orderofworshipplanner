import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import jsPDF from 'jspdf'

const STANDARD = 'standard'
const NONSTANDARD = 'nonstandard'

const DEFAULT_ITEMS = [
  { type: STANDARD, title: 'Prelude', position: 0, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Welcome & Announcements', position: 1, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Centering Song', position: 2, notes: '', script: '', fill_in: { song: '', artist: '', key: '' } },
  { type: STANDARD, title: 'Call to Worship', position: 3, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Choir Anthem', position: 4, notes: '', script: '', fill_in: { song: '', artist: '', key: '' } },
  { type: STANDARD, title: 'Prayer of Dedication', position: 5, notes: '', script: '', fill_in: {} },
  { type: NONSTANDARD, title: 'Special Music', position: 6, notes: '', script: '', fill_in: { song: '', artist: '', performer: '' } },
  { type: STANDARD, title: 'Offertory', position: 7, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Communion', position: 8, notes: '', script: '', fill_in: {} },
  { type: STANDARD, title: 'Postlude', position: 9, notes: '', script: '', fill_in: {} },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [items, setItems] = useState([])
  const [comments, setComments] = useState({})
  const [expanded, setExpanded] = useState({})
  const [serviceDate, setServiceDate] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = (7 - day) % 7 || 7
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  })
  const [saveStatus, setSaveStatus] = useState('Synced')
  const [dragSrcId, setDragSrcId] = useState(null)
  const [showExportModal, setShowExportModal] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((_event, session) => setSession(session))
  }, [])

  useEffect(() => {
    if (session) loadItems()
  }, [session, serviceDate])

  async function loadItems() {
    const { data, error } = await supabase.from('service_items').select('*').eq('service_date', serviceDate).order('position')
    if (error) return
    if (data.length === 0) {
      const toInsert = DEFAULT_ITEMS.map(i => ({ ...i, service_date: serviceDate }))
      const { data: inserted } = await supabase.from('service_items').insert(toInsert).select()
      setItems(inserted || [])
    } else {
      setItems(data)
      data.forEach(item => loadComments(item.id))
    }
  }

  async function loadComments(itemId) {
    const { data } = await supabase.from('comments').select('*').eq('item_id', itemId).order('created_at')
    if (data) setComments(prev => ({ ...prev, [itemId]: data }))
  }

  async function sendMagicLink() {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) alert(error.message)
    else setMagicSent(true)
  }

  async function saveItem(item) {
    setSaveStatus('Saving...')
    const { error } = await supabase.from('service_items').update({
      title: item.title, notes: item.notes, script: item.script, fill_in: item.fill_in, position: item.position
    }).eq('id', item.id)
    if (error) console.error(error)
    else setSaveStatus('Synced')
  }

  function updateItem(id, field, value) {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, [field]: value } : i)
      const item = updated.find(i => i.id === id)
      clearTimeout(window._saveTimer)
      window._saveTimer = setTimeout(() => saveItem(item), 800)
      return updated
    })
  }

  function updateFillIn(id, field, value) {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, fill_in: { ...i.fill_in, [field]: value } } : i)
      const item = updated.find(i => i.id === id)
      clearTimeout(window._saveTimer)
      window._saveTimer = setTimeout(() => saveItem(item), 800)
      return updated
    })
  }

  async function addComment(itemId, body, parentId = null) {
    if (!body.trim()) return
    const { error } = await supabase.from('comments').insert({
      item_id: itemId, parent_id: parentId, author_email: session.user.email,
      author_name: session.user.email.split('@')[0], body,
    })
    if (!error) loadComments(itemId)
  }

  async function addItem() {
    const title = prompt('Item title:')
    if (!title) return
    const type = window.confirm('Is this a non-standard item?') ? NONSTANDARD : STANDARD
    const fill_in = type === NONSTANDARD ? { song: '', artist: '', key: '' } : {}
    const { data } = await supabase.from('service_items').insert({
      service_date: serviceDate, type, title, position: items.length, notes: '', script: '', fill_in
    }).select()
    if (data) setItems(prev => [...prev, data[0]])
  }

  async function deleteItem(id) {
    await supabase.from('service_items').delete().eq('id', id)
    setItems(prev => {
      const filtered = prev.filter(i => i.id !== id)
      const withNewPositions = filtered.map((item, idx) => ({ ...item, position: idx }))
      withNewPositions.forEach(item => saveItem(item))
      return withNewPositions
    })
  }

  async function moveItem(id, directionOrTargetId) {
    const index = items.findIndex(i => i.id === id)
    if (index < 0) return

    let targetIndex
    if (directionOrTargetId === 'up') {
      if (index === 0) return
      targetIndex = index - 1
    } else if (directionOrTargetId === 'down') {
      if (index === items.length - 1) return
      targetIndex = index + 1
    } else {
      targetIndex = items.findIndex(i => i.id === directionOrTargetId)
    }

    const reordered = [...items]
    const [movedItem] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, movedItem)

    const withPositions = reordered.map((item, idx) => ({ ...item, position: idx }))
    setItems(withPositions)
    withPositions.forEach(item => saveItem(item))
  }

  function onDragStart(id) { setDragSrcId(id) }
  function onDrop(targetId) {
    if (!dragSrcId) return
    moveItem(dragSrcId, targetId)
    setDragSrcId(null)
  }

  function exportPDF(includeNotes, includeScript) {
    const doc = new jsPDF()
    doc.setFontSize(18); doc.text('Worship Service Order', 14, 20)
    doc.setFontSize(12); doc.text(serviceDate, 14, 28)
    let y = 40
    items.forEach(item => {
      if (y > 270) { doc.addPage(); y = 20 }
      doc.setFont(undefined, 'bold'); doc.text(item.title, 14, y); y += 7
      doc.setFont(undefined, 'normal'); doc.setFontSize(10)
      if (item.fill_in) {
        Object.entries(item.fill_in).forEach(([k, v]) => { if(v) { doc.text(`${k}: ${v}`, 14, y); y += 5 } })
      }
      if (includeNotes && item.notes) { doc.text(`Notes: ${item.notes}`, 14, y); y += 5 }
      if (includeScript && item.script) { doc.text(`Script: ${item.script}`, 14, y); y += 5 }
      y += 5
    })
    doc.save(`worship-${serviceDate}.pdf`)
  }

  if (!session) return (
    <div style={{ padding: '60px 20px', fontFamily: 'serif', maxWidth: 400, margin: '0 auto' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Worship Planner</h1>
      <p style={{ color: '#444', marginBottom: 32 }}>Enter the sanctuary via magic link.</p>
      {magicSent ? <div style={{ background: '#F5F2ED', border: '1px solid #D1CDC7', padding: '16px', borderRadius: 12 }}>Check your scroll (email)!</div> : (
        <>
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} 
            style={{ width: '100%', padding: '14px', borderRadius: 8, border: '1px solid #D1CDC7', fontSize: 16, marginBottom: 12, background: '#FDFCFB' }} />
          <button onClick={sendMagicLink} style={{ width: '100%', padding: '14px', background: '#3D3D3D', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 16 }}>Send Link</button>
        </>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', background: '#EAE7E2', minHeight: '100vh', fontFamily: 'serif', paddingBottom: 80 }}>
      <div style={{ position: 'sticky', top: 0, background: '#EAE7E2', padding: '16px', borderBottom: '1px solid #D1CDC7', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#2C2C2C' }}>Order of Worship</h2>
          <span style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: 1 }}>{saveStatus}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} 
            style={{ flex: 1, padding: '10px', borderRadius: 4, border: '1px solid #D1CDC7', background: '#F5F2ED', outline: 'none' }} />
          <button onClick={() => setShowExportModal(true)} style={headerBtnStyle}>Export</button>
          <button onClick={addItem} style={{ ...headerBtnStyle, background: '#5C635A', color: 'white', border: 'none' }}>+ Item</button>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        {items.map((item, index) => (
          <ItemCard 
            key={item.id} 
            item={item} 
            index={index} 
            totalItems={items.length} 
            comments={comments[item.id] || []} 
            expanded={!!expanded[item.id]} 
            onToggle={() => setExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
            onUpdate={updateItem} 
            onFillIn={updateFillIn} 
            onDelete={() => deleteItem(item.id)}
            onAddComment={addComment} 
            onDragStart={onDragStart} 
            onDrop={onDrop} 
            onMove={moveItem}
          />
        ))}
      </div>

      {showExportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#F5F2ED', padding: 24, borderRadius: 8, width: '100%', maxWidth: 340, border: '1px solid #D1CDC7' }}>
            <h3 style={{ marginTop: 0 }}>Export Manuscript</h3>
            <button onClick={() => { exportPDF(false, false); setShowExportModal(false) }} style={modalBtnStyle}>Bulletin Format</button>
            <button onClick={() => { exportPDF(true, false); setShowExportModal(false) }} style={modalBtnStyle}>With Notes</button>
            <button onClick={() => { exportPDF(true, true); setShowExportModal(false) }} style={modalBtnStyle}>Full Script</button>
            <button onClick={() => setShowExportModal(false)} style={{ width: '100%', background: 'none', border: 'none', color: '#777', marginTop: 12, cursor: 'pointer' }}>Return</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, index, totalItems, comments, expanded, onToggle, onUpdate, onFillIn, onDelete, onAddComment, onDragStart, onDrop, onMove }) {
  const isNS = item.type === NONSTANDARD
  const [msg, setMsg] = useState('')
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [touchStart, setTouchStart] = useState(null)
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const bgColor = index % 2 === 0 ? '#F5F2ED' : '#E3E5E2'

  const hasNotes = item.notes && item.notes.trim().length > 0
  const hasScript = item.script && item.script.trim().length > 0

  const handleTouchStart = (e) => setTouchStart(e.targetTouches[0].clientX)
  
  const handleTouchMove = (e) => {
    const currentTouch = e.targetTouches[0].clientX
    const diff = touchStart - currentTouch
    if (swipeOffset > 0 || diff > 0) {
      const newOffset = Math.max(0, Math.min(100, swipeOffset + diff))
      setSwipeOffset(newOffset)
    }
  }

  const handleTouchEnd = () => {
    if (swipeOffset > 50) setSwipeOffset(80) 
    else setSwipeOffset(0) 
  }

  const handleAction = (e) => {
    e.stopPropagation() // Stop interference
    if (swipeOffset > 0) setSwipeOffset(0)
    else onToggle()
  }

  return (
    <div style={{ position: 'relative', marginBottom: '12px', overflow: 'hidden', borderRadius: '8px' }}>
      <div 
        onClick={() => { if(window.confirm('Delete?')) onDelete(); setSwipeOffset(0) }}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: '#8B4513', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
        DELETE
      </div>

      <div 
        draggable={!isMobile} 
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(item.id) }} 
        onDragOver={e => e.preventDefault()} 
        onDrop={() => onDrop(item.id)}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onClick={handleAction}
        style={{ 
          background: bgColor, border: '1px solid #D1CDC7', zIndex: 2, position: 'relative',
          transition: 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.1)', transform: `translateX(-${swipeOffset}px)`,
          cursor: isMobile ? 'default' : 'pointer'
        }}
      >
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #AAA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#555', background: 'rgba(255,255,255,0.3)' }}>
            {index + 1}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: isNS ? '#8B4513' : '#5C635A', textTransform: 'uppercase', letterSpacing: 1 }}>{item.type}</div>
              <div style={{ display: 'flex', gap: 6, opacity: 0.5 }}>
                {hasNotes && <span style={{ fontSize: 8, fontWeight: 900 }}>NTS</span>}
                {hasScript && <span style={{ fontSize: 8, fontWeight: 900 }}>SCR</span>}
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 19, color: '#2C2C2C', lineHeight: 1.1 }}>{item.title}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {index > 0 && <button onClick={(e) => { e.stopPropagation(); onMove(item.id, 'up') }} style={arrowBtnStyle}>▲</button>}
                {index < totalItems - 1 && <button onClick={(e) => { e.stopPropagation(); onMove(item.id, 'down') }} style={arrowBtnStyle}>▼</button>}
              </div>
            ) : (
              <div style={{ color: '#AAA', cursor: 'grab', padding: '0 8px', fontSize: 18 }}>⠿</div>
            )}
            {/* THE KEBAB MENU TRIGGER */}
            <div 
              style={{ fontSize: 20, color: '#5C635A', opacity: 0.6, padding: '4px' }}
              onClick={(e) => { e.stopPropagation(); handleAction(e); }}
            >⋮</div>
          </div>
        </div>

        {expanded && (
          <div style={{ padding: '0 16px 20px', borderTop: '1px solid rgba(0,0,0,0.05)' }} onClick={e => e.stopPropagation()}>
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Item Name</label>
              <input value={item.title} onChange={e => onUpdate(item.id, 'title', e.target.value)} style={cleanInputStyle} />
            </div>
            {isNS && Object.keys(item.fill_in).map(f => (
              <div key={f} style={{ marginTop: 16 }}>
                <label style={labelStyle}>{f}</label>
                <input value={item.fill_in[f] || ''} onChange={e => onFillIn(item.id, f, e.target.value)} style={cleanInputStyle} />
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Director Notes</label>
              <textarea value={item.notes} onChange={e => onUpdate(item.id, 'notes', e.target.value)} style={{ ...cleanInputStyle, minHeight: 60 }} />
            </div>
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Full Script</label>
              <textarea value={item.script} onChange={e => onUpdate(item.id, 'script', e.target.value)} style={{ ...cleanInputStyle, minHeight: 100 }} />
            </div>
            
            <div style={{ marginTop: 24, background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#888', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 1 }}>Messages</div>
              {comments.map(c => <div key={c.id} style={{ fontSize: 14, marginBottom: 6, borderBottom: '1px solid rgba(0,0,0,0.02)', paddingBottom: 4 }}><strong>{c.author_name}:</strong> {c.body}</div>)}
              <input 
                value={msg} 
                onChange={e => setMsg(e.target.value)} 
                onKeyDown={e => { if(e.key === 'Enter') { onAddComment(item.id, msg); setMsg('') }}}
                placeholder="Write a message..." 
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #CCC', padding: '8px 0', fontSize: 14, outline: 'none', marginTop: 10 }} 
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = { fontSize: 9, fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }
const cleanInputStyle = { width: '100%', padding: '8px 0', border: 'none', borderBottom: '1px solid #D1CDC7', background: 'transparent', fontSize: 16, outline: 'none', fontFamily: 'serif', marginTop: 4 }
const headerBtnStyle = { padding: '10px 16px', borderRadius: 6, border: '1px solid #D1CDC7', background: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const arrowBtnStyle = { border: 'none', background: 'transparent', padding: '0 8px', fontSize: '10px', color: '#888', cursor: 'pointer' }
const modalBtnStyle = { width: '100%', padding: 14, textAlign: 'left', borderRadius: 6, border: '1px solid #D1CDC7', background: 'white', marginBottom: 10, fontSize: 16, fontFamily: 'serif', cursor: 'pointer' }