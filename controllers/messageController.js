// backend/controllers/messageController.js

const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { isBranchRole } = require('../middleware/auth');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

const buildVisibleContactQuery = (user, { excludeSelf = true } = {}) => {
  const query = { company: user.company };

  if (excludeSelf) {
    query._id = { $ne: user.id };
  }

  if (user.role === 'employee' && user.branchId) {
    query.branchId = user.branchId;
    query.role = { $in: ['employee', 'branch_manager', 'branch_hr'] };
  }

  return query;
};

// Returns IDs of admin/hr users who have already messaged a branch employee.
// Branch employees may only see/reply to admins who initiated first.
const getAdminHrWhoMessagedEmployee = async (userId, company) => {
  const senderIds = await Message.distinct('sender', {
    receiver: userId,
    company,
    isAnnouncement: false
  });
  if (!senderIds.length) return [];
  const admins = await User.find({
    _id: { $in: senderIds },
    company,
    role: { $in: ['admin', 'hr'] }
  }).select('_id');
  return admins.map(u => u._id.toString());
};

// Configure Cloudinary (if using)
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// @desc    Get conversation between two users
// @route   GET /api/v1/messages/:contactId
// @access  Private
exports.getConversation = async (req, res, next) => {
  try {
    const { contactId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Validate contact ID
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact ID'
      });
    }

    // Verify contact belongs to same company
    let contact = await User.findOne({
      ...buildVisibleContactQuery(req.user, { excludeSelf: false }),
      _id: contactId
    });

    // Branch employees may also open threads with admin/hr who messaged them first
    if (!contact && req.user.role === 'employee' && req.user.branchId) {
      const adminIds = await getAdminHrWhoMessagedEmployee(req.user.id, req.user.company);
      if (adminIds.includes(contactId)) {
        contact = await User.findOne({ _id: contactId, company: req.user.company });
      }
    }

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      });
    }

    const query = {
      $or: [
        { sender: req.user.id, receiver: contactId },
        { sender: contactId, receiver: req.user.id }
      ],
      company: req.user.company,
      isAnnouncement: false
    };

    const total = await Message.countDocuments(query);

    // Get messages between users
    const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name email role position company avatarUrl')
    .populate('receiver', 'name email role position company avatarUrl');

    // Mark messages as read for receiver
    if (String(req.user.id) !== String(contactId)) {
      await Message.updateMany(
        { 
          sender: contactId, 
          receiver: req.user.id, 
          readBy: { $ne: req.user.id } 
        },
        { $addToSet: { readBy: req.user.id } }
      );
    }

    res.status(200).json({
      success: true,
      count: messages.length,
      messages: messages.reverse(),
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Get conversation error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching conversation'
    });
  }
};

// @desc    Send a new message
// @route   POST /api/v1/messages/send
// @access  Private
exports.sendMessage = async (req, res, next) => {
  try {
    const { receiverId, content } = req.body;
    let { fileUrl, fileName, fileType } = req.body;

    // Validate required fields
    if (!receiverId && !content && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Please provide receiver and content or file'
      });
    }

    // Verify receiver belongs to same company
    let receiver = await User.findOne({
      ...buildVisibleContactQuery(req.user, { excludeSelf: false }),
      _id: receiverId
    });

    // Branch employees may reply to admin/hr who messaged them first
    if (!receiver && req.user.role === 'employee' && req.user.branchId) {
      const adminIds = await getAdminHrWhoMessagedEmployee(req.user.id, req.user.company);
      if (adminIds.includes(receiverId)) {
        receiver = await User.findOne({ _id: receiverId, company: req.user.company });
      }
    }

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Handle multiple file uploads
    const mimeToType = (mime) => {
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('video/')) return 'video';
      return 'document';
    };

    const uploadedFiles = req.files || [];
    const processedFiles = [];

    for (const file of uploadedFiles) {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        let result;
        try {
          result = await cloudinary.uploader.upload(file.path, {
            folder: 'autopay_messages',
            resource_type: 'auto',
            timeout: 60000
          });
        } catch (cloudErr) {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(502).json({ success: false, message: `File upload failed for "${file.originalname}": ${cloudErr.message}` });
        }
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        processedFiles.push({ url: result.secure_url, name: file.originalname, type: mimeToType(file.mimetype) });
      } else {
        processedFiles.push({
          url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
          name: file.originalname,
          type: mimeToType(file.mimetype)
        });
      }
    }

    const primary = processedFiles[0];

    // Create message
    const message = await Message.create({
      sender: req.user.id,
      receiver: receiverId,
      company: req.user.company,
      content: content || '',
      fileUrl: primary?.url || fileUrl || '',
      fileName: primary?.name || fileName || '',
      fileType: primary?.type || fileType || 'other',
      files: processedFiles,
      isAnnouncement: false
    });

    // Populate sender and receiver
    await message.populate('sender', 'name email role');
    await message.populate('receiver', 'name email role');

    // Emit message to receiver via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${receiverId}`).emit('message:receive', {
        message,
        sender: {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (err) {
    console.error('Send message error:', err);
    
    // Handle validation errors
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: message.join(', ')
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while sending message'
    });
  }
};

// @desc    Send an announcement (admin only)
// @route   POST /api/v1/messages/announcement
// @access  Private (Admin/HR)
exports.sendAnnouncement = async (req, res, next) => {
  try {
    const { content } = req.body;

    if (!content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ success: false, message: 'Please provide content or at least one file for the announcement' });
    }

    // Helper: determine file type from MIME
    const mimeToType = (mime) => {
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('video/')) return 'video';
      return 'document';
    };

    // Process uploaded files (local or Cloudinary)
    const processedFiles = [];
    const uploadedFiles = req.files || [];

    for (const file of uploadedFiles) {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        let result;
        try {
          result = await cloudinary.uploader.upload(file.path, {
            folder: 'autopay_announcements',
            resource_type: 'auto',
            timeout: 120000
          });
        } catch (cloudErr) {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(502).json({ success: false, message: `File upload failed for "${file.originalname}": ${cloudErr.message}` });
        }
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        processedFiles.push({ url: result.secure_url, name: file.originalname, type: mimeToType(file.mimetype) });
      } else {
        processedFiles.push({
          url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`,
          name: file.originalname,
          type: mimeToType(file.mimetype)
        });
      }
    }

    // Get recipients: branch roles send to their branch employees only
    let employeeIds;
    if (isBranchRole(req.user)) {
      const branchEmps = await Employee.find({ branchId: req.user.branchId }).distinct('userId');
      employeeIds = branchEmps;
    } else {
      const employees = await User.find({ company: req.user.company, role: 'employee' }).select('_id');
      employeeIds = employees.map(e => e._id);
    }

    // Primary attachment (first file) goes in legacy fields for backward compat
    const primary = processedFiles[0];

    const announcementPromises = employeeIds.map(employeeId =>
      Message.create({
        sender: req.user.id,
        receiver: employeeId,
        company: req.user.company,
        content: content || '',
        fileUrl: primary?.url || '',
        fileName: primary?.name || '',
        fileType: primary?.type || 'other',
        files: processedFiles,
        isAnnouncement: true
      })
    );

    const announcements = await Promise.all(announcementPromises);
    const populatedAnnouncements = await Message.populate(announcements, {
      path: 'sender',
      select: 'name email role avatarUrl'
    });

    const io = req.app.get('io');
    if (io) {
      populatedAnnouncements.forEach((announcement) => {
        io.to(`user_${announcement.receiver}`).emit('announcement:receive', {
          announcement,
          sender: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role
          }
        });
      });
    }

    res.status(201).json({
      success: true,
      message: 'Announcement sent to all employees',
      announcements: announcements.length
    });
  } catch (err) {
    console.error('Send announcement error:', err);
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(v => v.message);
      return res.status(400).json({ success: false, message: message.join(', ') });
    }
    res.status(500).json({ success: false, message: err.message || 'Server error while sending announcement' });
  }
};

// @desc    Get unread messages count
// @route   GET /api/v1/messages/unread-count
// @access  Private
exports.getUnreadCount = async (req, res, next) => {
  try {
    const unreadMessages = await Message.countDocuments({
      receiver: req.user.id,
      readBy: { $ne: req.user.id },
      isAnnouncement: false
    });

    const unreadAnnouncements = await Message.countDocuments({
      receiver: req.user.id,
      readBy: { $ne: req.user.id },
      isAnnouncement: true
    });

    res.status(200).json({
      success: true,
      count: unreadMessages + unreadAnnouncements,
      unreadMessages,
      unreadAnnouncements
    });
  } catch (err) {
    console.error('Get unread count error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching unread count'
    });
  }
};

// @desc    Get announcements for the current user
// @route   GET /api/v1/messages/announcements
// @access  Private
exports.getAnnouncements = async (req, res) => {
  try {
    let announcements;

    if (req.user.role === 'employee') {
      // Employees see announcements sent to them
      announcements = await Message.find({
        receiver: req.user.id,
        isAnnouncement: true
      })
        .sort({ createdAt: -1 })
        .populate('sender', 'name email role avatarUrl');

      await Message.updateMany(
        {
          receiver: req.user.id,
          isAnnouncement: true,
          readBy: { $ne: req.user.id }
        },
        { $addToSet: { readBy: req.user.id } }
      );
    } else {
      // Admin/HR: deduplicate by sender+second so each broadcast appears once
      const raw = await Message.aggregate([
        { $match: { company: req.user.company, isAnnouncement: true } },
        {
          $group: {
            _id: {
              sender: '$sender',
              timeKey: { $dateToString: { format: '%Y-%m-%dT%H:%M:%S', date: '$createdAt' } }
            },
            doc: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { createdAt: -1 } }
      ]);
      announcements = await Message.populate(raw, { path: 'sender', select: 'name email role avatarUrl' });
    }

    res.status(200).json({ success: true, announcements });
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching announcements' });
  }
};

// @desc    Get company contacts for messaging
// @route   GET /api/v1/messages/contacts
// @access  Private
exports.getContacts = async (req, res, next) => {
  try {
    // Get all users from the same company (excluding current user)
    const baseContacts = await User.find(buildVisibleContactQuery(req.user))
      .select('_id name email role position company avatarUrl branchId');

    // Branch employees also see admin/hr who have already messaged them
    let contacts = baseContacts;
    if (req.user.role === 'employee' && req.user.branchId) {
      const adminIds = await getAdminHrWhoMessagedEmployee(req.user.id, req.user.company);
      if (adminIds.length) {
        const existingIds = new Set(baseContacts.map(c => c._id.toString()));
        const adminContacts = await User.find({
          _id: { $in: adminIds },
          company: req.user.company
        }).select('_id name email role position company avatarUrl branchId');
        const newAdmins = adminContacts.filter(u => !existingIds.has(u._id.toString()));
        contacts = [...baseContacts, ...newAdmins];
      }
    }

    // Get last message for each contact
    const contactsWithLastMessage = await Promise.all(
      contacts.map(async (contact) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: req.user.id, receiver: contact._id.toString() },
            { sender: contact._id.toString(), receiver: req.user.id }
          ],
          company: req.user.company,
          isAnnouncement: false
        })
        .sort({ createdAt: -1 })
        .populate('sender', 'name')
        .populate('receiver', 'name');

        // Get unread message count
        const unreadCount = await Message.countDocuments({
          sender: contact._id.toString(),
          receiver: req.user.id,
          readBy: { $ne: req.user.id },
          isAnnouncement: false
        });

        return {
          user: {
            id: contact._id.toString(),
            name: contact.name,
            email: contact.email,
            role: contact.role,
            position: contact.position || '',
            company: contact.company,
            avatarUrl: contact.avatarUrl || '',
            branchId: contact.branchId || null
          },
          lastMessage: lastMessage ? {
            id: lastMessage._id,
            content: lastMessage.content,
            sender: lastMessage.sender._id,
            receiver: lastMessage.receiver._id,
            createdAt: lastMessage.createdAt
          } : null,
          unreadCount
        };
      })
    );

    res.status(200).json({
      success: true,
      count: contactsWithLastMessage.length,
       contacts: contactsWithLastMessage
    });
  } catch (err) {
    console.error('Get contacts error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching contacts'
    });
  }
};
