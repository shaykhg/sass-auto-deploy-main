require('dotenv').config()
const bodyParser = require('body-parser')
const axios = require('axios');
const Mailgun = require('mailgun-js');
const express = require('express'),
    path = require('path'),
    app = express();
const router = express.Router();
const cron = require('node-cron');
const nodemailer = require("nodemailer");


// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}))

// parse application/json
app.use(bodyParser.json())

app.use(express.static(path.join(__dirname, 'www')));

let scheduler;
let transporter;
const domain = 'https://api.ideatechnologies.io'
let stripe;

app.get('*', function (req, res) {
    res.sendFile(path.join(__dirname, 'www/index.html'));
});

function getApiKey(){
    console.log('Getting API keys', `https://api.ideatechnologies.io/apps/type?site=${process.env.id}&access_token=`)
    axios.get(`https://api.ideatechnologies.io/apps/type?site=${process.env.id}&access_token=`)
        .then(res => {
            res.data.forEach( item=> {
                if (item.type === 'email') {
                    mailKey = item.apiKey1
                    mailDomain = item.username.split('@')[1];
                    transporter =  nodemailer.createTransport({
                        host: item.identifier,
                        port: 465,
                        secure: true, // true for 465, false for other ports
                        auth: {
                            user: item.username, // generated ethereal user
                            pass: item.password, // generated ethereal password
                        },
                    });

                } else if (item.type === 'calendar'){
                    scheduler = item
                    refreshToken()
                } else if (item.name.toLowerCase() === 'stripe'){
                    stripe = require('stripe')(item.apiKey2);
                } else {
                    // something else
                }
            })

        }).catch(err => {
        console.log('An err occurred!', err)
    });

}

async function refreshToken() {
    //call strapi
    const body = {identifier: scheduler.username, password: scheduler.password};
    try {
        const res = await axios.post('https://api.litcode.io/auth/local', body);
        console.log('Request to scheduler was success');
        scheduler.token = res.data.jwt;
    } catch (e) {
        console.log('Failed to refresh token', e);
    }
}

app.post('/order/place/', async (req, res) => {
    const body = req.body;
    body.status = 'PENDING';
    body.access_token = process.env.master;
    try {
        const response = await axios.post(`${domain}/orders`, body)
        res.send({status: 1, order: response.data})
    } catch (e){
        console.log('An error occurred while placing orders!')
        res.send({status: 0})
    }
});

app.post('/order/status/', async (req, res) => {
    const body = req.body;
    body.access_token = process.env.master;

    // order - order id, name = user's name, status = FAILED or PAID

    const name = (body.name || body.fname) || ''
    try {

        // Order will update from next line based on body
        const response = await axios.patch(`${domain}/orders/${body.order}`, body)
        const order = response.data;
        try {
            if (!order.contactMe && body.status === 'PAID'){
                // block slot
                const headers = {
                    'Authorization': 'Bearer ' + scheduler.token,
                };
                console.log('About to Update Slot', order, {available: false, booking: order.id, user: name, slot: order.slot , company: scheduler.apiKey1}, {headers})
                const slot = await axios.post('https://api.litcode.io/slots/book', {available: false, booking: order.id, user: name, slot: order.slot , company: scheduler.apiKey1}, {headers});
                console.log('Slot Updated', slot.data)
                if (slot.data.status === 1){
                    // slot booked successfully!
                    // Now we need to send email and we are good to go!
                    // send email
                    res.send({status: 1, order});

                } else {
                    res.send({status: 0, msg: 'An error occurred while updating order!'})
                }
            } else {

            }

        }catch (e) {
            console.log('Unable to update slot!')
            console.log('Error', e)
            res.send({status: 0, msg: 'An error occurred while updating order!'})
        }
    } catch (e){
        console.log('An error occurred while updating order!')
        res.send({status: 0, msg: 'An error occurred while updating order!'})
    }
});


// This example sets up an endpoint using the Express framework.
// Watch this video to get started: https://youtu.be/rPR2aJ6XnAc.


app.post('/create-checkout-session', async (req, res) => {
    const body = req.body;
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: body.products,
        mode: 'payment',
        success_url: body.success_url,
        cancel_url: body.cancel_url,
    });

    res.json({ id: session.id });
});


app.post('/site', function (req, res) {
    axios.get(`${domain}/sites/${process.env.id}`).then(body => {
        res.send(body.data)
    }).catch(err => {
        console.log(err);
        res.status(404).send();
    });
});

app.post('/sendMail', async function (req, res) {

    try {
        let info = await transporter.sendMail({
            from: `no-reply@${mailDomain}`, // sender address
            to: req.body.to, // list of receivers
            subject: req.body.subject, // Subject line
            text: req.body.text, // plain text body
            html: req.body.html, // html body
        });

        console.log("Message sent: %s", info.messageId);
        res.send({status: 1, msg: 'Message sent successfully'})
    } catch (e){
        console.log(e)
        res.send({status: -1, msg: 'Message not sent!'})
    }

});


app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, sessionStoreService, x-session-token");
    next();
});

cron.schedule('0 */30 * * * *', () => {
    console.log('running a task every 30 minute');
    getApiKey();
});

getApiKey();
app.listen(process.env.port);
console.log('Running on port -> ', process.env.port)
