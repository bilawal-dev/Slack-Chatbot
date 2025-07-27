import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import prisma from '../config/database.js'

export default class AuthController {
    static async Signup(req, res) {
        const { email, password, name } = req.body

        if (!email || !password)
            return res.status(400).json({ success: false, message: 'Email and password required' })

        if (password.length < 8)
            return res.status(400).json({ success: false, message: 'Password must be ≥8 chars' })

        try {
            const existing = await prisma.user.findUnique({ where: { email } })

            if (existing)
                return res.status(409).json({ success: false, message: 'Email already in use' })

            const hash = await bcrypt.hash(password, 12)
            const user = await prisma.user.create({
                data: { email, password: hash, name }
            })

            res.status(201).json({
                success: true,
                message: 'User created successfully',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name
                }
            })
        } catch (err) {
            res.status(500).json({ success: false, message: 'Server error' })
        }
    }

    static async Login(req, res) {
        const { email, password } = req.body

        if (!email || !password)
            return res.status(400).json({ success: false, message: 'Email and password required' })

        try {
            const user = await prisma.user.findUnique({ where: { email } })
            if (!user)
                return res.status(401).json({ success: false, message: 'Invalid credentials' })

            const match = await bcrypt.compare(password, user.password)
            if (!match)
                return res.status(401).json({ success: false, message: 'Invalid credentials' })

            const payload = {
                id: user.id,
                email: user.email,
                name: user.name
            }

            const JWT_SECRET = process.env.JWT_SECRET

            if (!JWT_SECRET)
                return res.status(500).json({ success: false, message: 'JWT_SECRET not found' })

            const token = jwt.sign(payload, JWT_SECRET)

            res.json({
                success: true,
                message: 'Login successful',
                token
            })
        } catch (err) {
            res.status(500).json({ success: false, message: 'Server error' })
        }
    }

    static async Authenticate(req, res) {
        const { id, email, name } = req.user
        res.json({
            success: true,
            message: 'User authenticated',
            user: { id, email, name }
        })
    }
}
