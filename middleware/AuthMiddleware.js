import jwt from 'jsonwebtoken'

export function AuthenticateToken(req, res, next) {
    const auth = req.headers.authorization

    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' })
    }

    const token = auth.split(' ')[1]

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' })
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Invalid token' })
        req.user = user
        next()
    })
}
