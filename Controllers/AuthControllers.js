const Authentication = require('../Models/Authentication');
const Employee = require('../Models/Employee');
const Attendance = require('../Models/Attendance');
const moment = require('moment-timezone');


function calculateSessionDuration(inTime, outTime) {
  const inTimeParts = inTime.split(':');
  const outTimeParts = outTime.split(':');

  const inMinutes = parseInt(inTimeParts[0]) * 60 + parseInt(inTimeParts[1]);
  const outMinutes = parseInt(outTimeParts[0]) * 60 + parseInt(outTimeParts[1]);

  return outMinutes - inMinutes;
}

exports.login = async (req, res) => {
  try {
    const { secretKey } = req.body;

    const authRecord = await Authentication.findOne({ Secretkey: secretKey }).populate('employeeId');
    if (!authRecord) {
      return res.status(401).json({ error: 'Invalid Secret Key' });
    }

    const employee = authRecord.employeeId;

    const now = moment().tz('Asia/Karachi');
    const today = now.format('YYYY-MM-DD');
    const currentTime = now.format('HH:mm:ss');
    let attendance = await Attendance.findOne({
      employee: employee._id,
      date: today,
    });

    if (!attendance) {
      attendance = await Attendance.create({
        employee: employee._id,
        date: today,
        in_time: currentTime,
        is_logged_in: true,
      });

      return res.status(200).json({
        message: 'Login successful (Time-In recorded)',
        employeeId: employee._id,
        attendanceId: attendance._id,
        roleCompany: employee.role_company,
        employeeName: employee.name,
        inTime: attendance.in_time,
        isLoggedIn: attendance.is_logged_in,
      });
    } else if (!attendance.out_time) {
      attendance.out_time = currentTime;
      attendance.session_duration = calculateSessionDuration(attendance.in_time, attendance.out_time);
      attendance.is_logged_in = false;
      await attendance.save();

      return res.status(200).json({
        message: 'Logout successful (Time-Out recorded)',
        employeeId: employee._id,
        employeeName: employee.name,
        roleCompany: employee.role_company,
        inTime: attendance.in_time,
        outTime: attendance.out_time,
        sessionDuration: attendance.session_duration,
        isLoggedIn: attendance.is_logged_in,
      });
    } else {
      return res.status(400).json({ error: 'Attendance already marked for today' });
    }
  } catch (error) {
    res.status(500).json({ error: 'This employee has been deleted from record.!' });
  }
};

exports.logout = async (req, res) => {
  try {
    const { secretKey } = req.body;

    // Validate the secret key
    const authRecord = await Authentication.findOne({ Secretkey: secretKey }).populate('employeeId');
    if (!authRecord) {
      return res.status(401).json({ error: 'Invalid Secret Key' });
    }

    const employee = authRecord.employeeId;

    // Get today's date in Pakistan's timezone
    const now = moment().tz('Asia/Karachi');
    const today = now.format('YYYY-MM-DD'); // Format date
    const currentTime = now.format('HH:mm:ss'); // Format time

    // Find the attendance record for today
    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: today,
    });

    // Check if the user has an active login session
    if (!attendance || !attendance.is_logged_in) {
      return res.status(400).json({
        error: 'No active login session found or user already logged out.',
      });
    }

    // Record logout details
    attendance.out_time = currentTime; // Record logout time
    attendance.session_duration = calculateSessionDuration(
      attendance.in_time,
      attendance.out_time
    );
    attendance.is_logged_in = false; // Mark as logged out

    await attendance.save();

    return res.status(200).json({
      message: 'Logout successful (Time-Out recorded)',
      employeeId: employee._id,
      employeeName: employee.name,
      inTime: attendance.in_time,
      outTime: attendance.out_time,
      sessionDuration: attendance.session_duration,
      isLoggedIn: attendance.is_logged_in,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

