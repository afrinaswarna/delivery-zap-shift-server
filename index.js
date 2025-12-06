const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIP_SECRET);
const port = process.env.PORT || 3000;
const crypto = require("crypto");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-adminsdk.json");
const { accessSync } = require("fs");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 chars
  return `${prefix}-${date}-${random}`;
}

module.exports = generateTrackingId;

// middleware

app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("after decoded", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

// middleware for database access
// must be used after verifyFBToken middleware

const verifyAdmin = async (req, res, next) => {
  const email = req.decoded_email;
  const query = { email };
  const user = await userCollection.findOne(query);
  if (!user || user.role !== "admin") {
    return res.status(403).send({ massage: "forbidden access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.52cv5mu.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("zap_shift_db_user");
    const userCollection = db.collection("users");
    const parcelCollection = db.collection("parcel");
    const paymentCollection = db.collection("payments");
    const ridersCollection = db.collection("riders");
    const trackingCollection = db.collection("tracking");

  //  user apis

  const logTracking =async(trackingId,status)=>{
  const log={
    
    trackingId,
    status,
    details:status.split('-').join(' '),
    createdAt :new Date()
  }

  const result = await trackingCollection.insertOne(log)
  return result
}
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchUser = req.query.searchUser;
      const query = {};
      if (searchUser) {
        query.$or = [
          { displayName: { $regex: searchUser, $options: "i" } },
          { email: { $regex: searchUser, $options: "i" } },
        ];
      }
      const cursor = userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(3);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/user", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      email = user.email;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res.send({ massage: "user exist" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );
    // parcel related apis
    app.get("/parcel", async (req, res) => {
      const query = {};

      const { email, deliveryStatus } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcel/rider", async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};
      if (riderEmail) {
        query.riderEmail = riderEmail;
      }
      if (deliveryStatus !== "parcel-delivered") {
       
        query.deliveryStatus = { $nin: ["parcel-delivered"] };
      }
      else{
        query.deliveryStatus   = deliveryStatus
      }
      const cursor = parcelCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcel", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.patch("/parcel/:id", async (req, res) => {
      const { riderId, riderName, riderEmail,trackingId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: "driver-assigned",
          riderId: riderId,
          riderEmail: riderEmail,
          riderName: riderName,
        },
      };
      const result = await parcelCollection.updateOne(query, updatedDoc);
      // updata rider info
      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdatedDoc = {
        $set: {
          workStatus: "in-delivery",
        },
      };
      const riderResult = await ridersCollection.updateOne(
        riderQuery,
        riderUpdatedDoc
      );

      logTracking(trackingId,"driver-assigned")
      res.send(riderResult);
    });

    app.patch("/parcel/:id/status", async (req, res) => {
      const { deliveryStatus, riderId,trackingId } = req.body;
      const query = { _id: new ObjectId(req.params.id) };
      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };
      if (deliveryStatus === "parcel-delivered") {
        const riderQuery = { _id: new ObjectId(riderId) };
        const riderUpdatedDoc = {
          $set: {
            workStatus: "available",
          },
        };
        const riderResult = await ridersCollection.updateOne(
          riderQuery,
          riderUpdatedDoc
        );
      }
      const result = await parcelCollection.updateOne(query, updatedDoc);
      logTracking(trackingId,deliveryStatus)
      res.send(result);
    });

    app.delete("/parcel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: paymentInfo.parcelName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },

        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    // old
    // app.post("/create-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100;
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "USD",
    //           product_data: {
    //             name: paymentInfo.parcelName,
    //           },
    //           unit_amount: amount,
    //         },
    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: "payment",
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   });
    //   console.log(session);
    //   res.send({ url: session.url });
    // });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log("session retrieve", session)
      const trackingId = generateTrackingId();
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const existingPayment = await paymentCollection.findOne(query);
      console.log(existingPayment);
      if (existingPayment) {
        return res.send({
          message: "payment already done",
          transactionId,
          trackingId: existingPayment.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "pending-pickup",
            trackingId: trackingId,
          },
        };
        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);

          logTracking(trackingId,'pending-pickup')
          res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }
      res.send({ success: false });
    });

    // payment releted api

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      // console.log(req.headers);
      const query = {};
      if (email) {
        query.customerEmail = email;
      }

      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // rider related apis
    app.get("/riders", async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {};

      if (status) {
        query.status = status;
      }
      if (district) {
        query.district = district;
      }
      if (workStatus) {
        query.workStatus = workStatus;
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      (rider.status = "pending"), (rider.createdAt = new Date());
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.patch("/riders/:id", verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
          workStatus: "available",
        },
      };
      const result = await ridersCollection.updateOne(query, updatedDoc);

      if (status === "approved") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "rider",
          },
        };
        const result = await userCollection.updateOne(userQuery, updateUser);
      }
      res.send(result);
    });

    // tracking apis 
    app.get('/trackings/:trackingId/logs',async(req,res)=>{
      const trackingId = req.params.trackingId
      const query = {trackingId}
      const result = await trackingCollection.find(query).toArray()
      res.send(result)
    })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}

run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("zap is shifting shifting");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
