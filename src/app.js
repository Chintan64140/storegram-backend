import express from 'express'
import cors from 'cors'
import userRoutes from './routes/user.routes.js'
import authRoutes from './routes/auth.routes.js'
import referalRoutes from './routes/referal.routes.js'
import paymentRoutes from './routes/payment.routes.js'
import fileRoutes from './routes/file.routes.js'
import publisherRoutes from './routes/publisher.routes.js'
import storageRoutes from './routes/storage.routes.js'
import folderRoutes from './routes/folder.routes.js'
import linkRoutes from './routes/link.routes.js'
import adminRoutes from './routes/admin.routes.js'
import trackRoutes from './routes/track.routes.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/referrals', referalRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/files', fileRoutes)
app.use('/publisher', publisherRoutes)
app.use('/api/storage', storageRoutes)
app.use('/api/folders', folderRoutes)
app.use('/api/links', linkRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/track', trackRoutes)

app.get('/', (req, res) => {
  res.send('StoreGram API running 🚀')
})

export default app